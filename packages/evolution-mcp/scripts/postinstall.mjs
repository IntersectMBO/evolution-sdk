import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { createConnection } from "node:net"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distBin = join(packageRoot, "dist", "bin.js")
const serviceName = process.env.EVOLUTION_MCP_SERVICE_NAME ?? "evolution-mcp"
const host = process.env.EVOLUTION_MCP_HOST ?? "127.0.0.1"
const port = Number.parseInt(process.env.EVOLUTION_MCP_PORT ?? "10000", 10)
const strict = process.env.EVOLUTION_MCP_POSTINSTALL_STRICT === "1"
const shouldSkip =
  process.env.EVOLUTION_MCP_SKIP_POSTINSTALL === "1" ||
  process.env.CI === "true" ||
  process.env.npm_config_global === "true"

const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
const xdgStateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
const systemdDir = join(xdgConfigHome, "systemd", "user")
const stateDir = join(xdgStateHome, serviceName)
const logFile = join(stateDir, "server.log")
const pidFile = join(stateDir, "server.pid")
const serviceFile = join(systemdDir, `${serviceName}.service`)

const info = (message) => process.stdout.write(`[${serviceName}] ${message}\n`)
const warn = (message) => process.stderr.write(`[${serviceName}] ${message}\n`)

const failOrWarn = (message) => {
  if (strict) {
    throw new Error(message)
  }

  warn(message)
}

const pathExists = async (target) => {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const commandAvailable = async (command) =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" })
    child.on("close", (code) => resolve(code === 0))
    child.on("error", () => resolve(false))
  })

const canUseSystemdUser = async () => {
  if (!(await commandAvailable("systemctl"))) {
    return false
  }

  return new Promise((resolve) => {
    let output = ""
    const child = spawn("systemctl", ["--user", "show-environment"], { stdio: ["ignore", "pipe", "pipe"] })

    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      output += chunk.toString()
    })

    child.on("close", (code) => {
      const normalizedOutput = output.toLowerCase()
      const unavailable = normalizedOutput.includes("systemd") && normalizedOutput.includes("not running")
      resolve(code === 0 && !unavailable)
    })
    child.on("error", () => resolve(false))
  })
}

const isPortReachable = async () =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port })
    socket.once("connect", () => {
      socket.end()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const waitForReachable = async ({ timeoutMs = 15000, intervalMs = 250 } = {}) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await isPortReachable()) {
      return true
    }

    await sleep(intervalMs)
  }

  return isPortReachable()
}

const startDetached = async () => {
  await mkdir(stateDir, { recursive: true })

  const launchCommand = (await commandAvailable("setsid")) ? "setsid" : process.execPath
  const launchArgs = launchCommand === "setsid" ? [process.execPath, distBin, "serve"] : [distBin, "serve"]
  const child = spawn(launchCommand, launchArgs, {
    cwd: packageRoot,
    detached: launchCommand !== "setsid",
    stdio: "ignore",
    env: {
      ...process.env,
      EVOLUTION_MCP_HOST: host,
      EVOLUTION_MCP_PORT: String(port)
    }
  })

  child.unref()
  await writeFile(pidFile, `${child.pid ?? ""}\n`, "utf8")
}

const cleanupStalePid = async () => {
  if (!(await pathExists(pidFile))) {
    return
  }

  const pid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10)
  if (!Number.isInteger(pid)) {
    await rm(pidFile, { force: true })
    return
  }

  try {
    process.kill(pid, 0)
  } catch {
    await rm(pidFile, { force: true })
  }
}

const installSystemdService = async () => {
  await mkdir(systemdDir, { recursive: true })
  await mkdir(stateDir, { recursive: true })

  const unit = [
    "[Unit]",
    "Description=Evolution MCP HTTP server",
    "After=default.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${packageRoot}`,
    `Environment=EVOLUTION_MCP_HOST=${host}`,
    `Environment=EVOLUTION_MCP_PORT=${port}`,
    `ExecStart=${process.execPath} ${distBin} serve`,
    `StandardOutput=append:${logFile}`,
    `StandardError=append:${logFile}`,
    "Restart=on-failure",
    "RestartSec=2",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n")

  await writeFile(serviceFile, unit, "utf8")

  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("systemctl", ["--user", ...args], { stdio: "ignore" })
      child.on("close", (code) => {
        if (code === 0) {
          resolve(undefined)
          return
        }
        reject(new Error(`systemctl --user ${args.join(" ")} exited with code ${code}`))
      })
      child.on("error", reject)
    })

  await run(["daemon-reload"])
  await run(["enable", "--now", `${serviceName}.service`])
}

const main = async () => {
  if (shouldSkip) {
    info("Skipping postinstall bootstrap")
    return
  }

  if (process.platform !== "linux") {
    failOrWarn(
      "Automatic postinstall bootstrap is only implemented for Linux. On macOS and Windows, the server will not start automatically; start it manually with: node dist/bin.js serve"
    )
    return
  }

  if (!(await pathExists(distBin))) {
    failOrWarn("Built server entrypoint not found. Build the package, then start manually with: node dist/bin.js serve")
    return
  }

  if (await isPortReachable()) {
    info(`Port ${port} is already serving. Skipping bootstrap.`)
    return
  }

  await cleanupStalePid()

  try {
    if (await canUseSystemdUser()) {
      await installSystemdService()
    } else {
      await startDetached()
    }
  } catch (error) {
    warn(`Automatic bootstrap failed: ${error instanceof Error ? error.message : String(error)}`)
    try {
      await startDetached()
    } catch (fallbackError) {
      failOrWarn(
        `Fallback bootstrap failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}. Start manually with: node dist/bin.js serve`
      )
      return
    }
  }

  const becameReachable = await waitForReachable()
  if (becameReachable) {
    info(`MCP server is available at http://${host}:${port}/mcp`)
    return
  }

  failOrWarn(`Bootstrap completed but the server is not reachable yet. Check ${logFile} or run: node dist/bin.js serve`)
}

void main().catch((error) => {
  if (strict) {
    throw error
  }
  warn(error instanceof Error ? error.message : String(error))
})