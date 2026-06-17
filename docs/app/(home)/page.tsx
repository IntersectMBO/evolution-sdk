"use client"

import Link from "next/link"
import { useState, type ComponentType } from "react"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import { SiNpm, SiPnpm, SiYarn, SiBun, SiNodedotjs, SiDeno } from "@icons-pack/react-simple-icons"
import { Globe, Package, RefreshCw, Landmark, ShieldCheck, Zap, Cloud, Server, type LucideProps } from "lucide-react"

const packageManagers = [
  { id: "npm", name: "npm", icon: SiNpm, color: "#CB3837", command: "npm install @evolution-sdk/evolution" },
  { id: "pnpm", name: "pnpm", icon: SiPnpm, color: "#F69220", command: "pnpm add @evolution-sdk/evolution" },
  { id: "yarn", name: "yarn", icon: SiYarn, color: "#2C8EBB", command: "yarn add @evolution-sdk/evolution" },
  { id: "bun", name: "bun", icon: SiBun, color: "#FBF0DF", command: "bun add @evolution-sdk/evolution" }
]

const quickStartCode = `import { Address, Assets, Client, preprod } from "@evolution-sdk/evolution"

// 1. Create a client
const sdk = Client.make(preprod)
  .withBlockfrost({ baseUrl: "...", projectId: "..." })
  .withSeed({ mnemonic: "your 24 words here" })

// 2. Build a transaction
const tx = await sdk.newTx()
  .payToAddress({
    address: Address.fromBech32("addr_test1..."),
    assets: Assets.fromLovelace(5_000_000n)
  })
  .build()

// 3. Sign and submit
const hash = await tx.sign().then(s => s.submit())`

const features: Array<{ icon: ComponentType<LucideProps>; title: string; description: string }> = [
  {
    icon: Globe,
    title: "Works Everywhere",
    description: "Pure TypeScript, no WASM, no native binaries. Runs in Node, Bun, Deno, browsers, and edge functions."
  },
  {
    icon: Package,
    title: "Tiny Bundle Size",
    description: "No WASM bloat. Tree-shakeable modules mean you ship only what you use."
  },
  {
    icon: RefreshCw,
    title: "Bidirectional Serialization",
    description: "Full CDDL spec coverage. Encode and decode all Cardano types with round-trip CBOR support."
  },
  {
    icon: Landmark,
    title: "Conway Ready",
    description: "Full governance support. DReps, treasury actions, constitutional committee, and voting."
  },
  {
    icon: ShieldCheck,
    title: "Type-Safe by Default",
    description: "Full TypeScript inference from transaction building to submission. If it compiles, it works."
  },
  {
    icon: Zap,
    title: "Effect-Powered",
    description: "Built on Effect for composable, testable, and maintainable code with proper error handling."
  }
]

const runtimes = [
  { name: "Node.js", icon: SiNodedotjs, color: "#339933" },
  { name: "Bun", icon: SiBun, color: "#FBF0DF" },
  { name: "Deno", icon: SiDeno, color: "#70FFAF" },
  { name: "Browsers", icon: Globe, color: "#60A5FA" },
  { name: "Edge Functions", icon: Cloud, color: "#A78BFA" },
  { name: "Serverless", icon: Server, color: "#F472B6" }
]

function PackageManagerTabs() {
  const [selected, setSelected] = useState("npm")
  const [copied, setCopied] = useState(false)

  const selectedPm = packageManagers.find((pm) => pm.id === selected) ?? packageManagers[0]

  const copyToClipboard = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(selectedPm.command)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <div className="rounded-xl border border-fd-border bg-fd-card overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-fd-border bg-fd-muted/50">
        {packageManagers.map((pm) => {
          const Icon = pm.icon
          return (
            <button
              key={pm.id}
              onClick={() => setSelected(pm.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                selected === pm.id
                  ? "text-fd-foreground bg-fd-card border-b-2 border-fd-primary -mb-px"
                  : "text-fd-muted-foreground hover:text-fd-foreground"
              }`}
            >
              <Icon size={16} color={selected === pm.id ? pm.color : "currentColor"} />
              {pm.name}
            </button>
          )
        })}
      </div>

      {/* Command */}
      <div className="flex items-center justify-between px-4 py-3">
        <code className="text-sm font-mono text-fd-foreground">{selectedPm.command}</code>
        <button
          onClick={copyToClipboard}
          aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
          className="flex items-center gap-1.5 text-xs text-fd-muted-foreground hover:text-fd-foreground transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 py-24 sm:py-32 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold text-fd-primary mb-4">Cardano SDK for TypeScript</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl bg-gradient-to-r from-fd-foreground to-fd-muted-foreground bg-clip-text text-transparent">
            Build Cardano Apps
            <br />
            <span className="text-fd-primary">Without the Pain</span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-fd-muted-foreground max-w-2xl mx-auto">
            Pure TypeScript. No WASM. No CML. No CSL. No libsodium. Built by No Witness Labs for the modern Cardano
            ecosystem.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-4">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
            >
              Get Started
            </Link>
            <Link
              href="https://github.com/IntersectMBO/evolution-sdk"
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-fd-foreground border border-fd-border hover:bg-fd-accent transition-colors"
            >
              View on GitHub →
            </Link>
          </div>
          <p className="mt-4 text-xs text-fd-muted-foreground font-mono">npm install @evolution-sdk/evolution</p>

          {/* Key Differentiators */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full bg-fd-muted px-3 py-1 text-xs font-medium">Pure TypeScript</span>
            <span className="rounded-full bg-fd-muted px-3 py-1 text-xs font-medium">Zero WASM</span>
            <span className="rounded-full bg-fd-muted px-3 py-1 text-xs font-medium">Conway Era</span>
            <span className="rounded-full bg-fd-primary/10 text-fd-primary px-3 py-1 text-xs font-medium">
              No Witness Labs
            </span>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className="px-6 py-16 lg:px-8 border-t border-fd-border">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold mb-2">Quick Start</h2>
          <p className="text-fd-muted-foreground mb-8">Create, build, sign, and submit — that's it</p>
          <div className="rounded-xl border border-fd-border bg-fd-card overflow-hidden text-left">
            <DynamicCodeBlock lang="ts" code={quickStartCode} />
          </div>
          <p className="mt-6 text-sm text-fd-muted-foreground">
            No manual UTxO selection. No fee calculation. No change handling.
            <br />
            Evolution SDK handles it all.
          </p>
        </div>
      </section>

      {/* Module Packages */}
      <section className="px-6 py-16 lg:px-8 border-t border-fd-border bg-fd-muted/30">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold mb-2">Modular by Design</h2>
          <p className="text-center text-fd-muted-foreground mb-10">
            Import only what you need. Tree-shakeable for minimal bundle size.
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-fd-border bg-fd-card px-4 py-3">
              <code className="text-sm font-mono">@evolution-sdk/evolution</code>
              <span className="text-xs text-fd-muted-foreground">Full SDK with client & tx builder</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-fd-border bg-fd-card px-4 py-3">
              <code className="text-sm font-mono">@evolution-sdk/evolution/plutus</code>
              <span className="text-xs text-fd-muted-foreground">Smart contract interactions</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-fd-border bg-fd-card px-4 py-3">
              <code className="text-sm font-mono">@evolution-sdk/evolution/blueprint</code>
              <span className="text-xs text-fd-muted-foreground">Aiken blueprint parsing</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-fd-border bg-fd-card px-4 py-3">
              <code className="text-sm font-mono">@evolution-sdk/evolution/message-signing</code>
              <span className="text-xs text-fd-muted-foreground">CIP-8 message signing</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-fd-border bg-fd-card px-4 py-3">
              <code className="text-sm font-mono">@evolution-sdk/evolution/uplc</code>
              <span className="text-xs text-fd-muted-foreground">Untyped Plutus Core</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="px-6 py-16 lg:px-8 border-t border-fd-border">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold mb-2">Everything You Need</h2>
          <p className="text-center text-fd-muted-foreground mb-10">Batteries included, zero configuration required</p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="rounded-xl border border-fd-border bg-fd-card p-6 hover:border-fd-primary/50 transition-colors"
                >
                  <Icon className="w-6 h-6 text-fd-primary mb-3" />
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm text-fd-muted-foreground">{feature.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Works Everywhere */}
      <section className="px-6 py-16 lg:px-8 border-t border-fd-border">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold mb-2">Works Everywhere</h2>
          <p className="text-center text-fd-muted-foreground mb-10">No native compilation. No platform restrictions.</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {runtimes.map((runtime) => (
              <div
                key={runtime.name}
                className="flex items-center justify-center gap-2 rounded-lg border border-fd-border bg-fd-card px-4 py-3"
              >
                <runtime.icon size={18} style={{ color: runtime.color }} />
                <span className="text-sm font-medium">{runtime.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install */}
      <section className="px-6 py-16 lg:px-8 border-t border-fd-border bg-fd-muted/30">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold mb-2">Get Started in Seconds</h2>
          <p className="text-fd-muted-foreground mb-8">Install the package and start building</p>

          <PackageManagerTabs />

          <div className="mt-10">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-semibold text-fd-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
            >
              Read the Documentation →
            </Link>
          </div>
        </div>
      </section>

      {/* Resources */}
      <section className="px-6 py-16 border-t border-fd-border">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-2xl font-bold text-fd-foreground mb-4">Resources</h2>
          <p className="text-fd-muted-foreground mb-8">
            Get started with guides, explore the source, or try the interactive playground.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/docs"
              className="rounded-lg border border-fd-border bg-fd-card px-6 py-3 text-sm font-medium text-fd-foreground hover:bg-fd-accent transition-colors"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/IntersectMBO/evolution-sdk"
              className="rounded-lg border border-fd-border bg-fd-card px-6 py-3 text-sm font-medium text-fd-foreground hover:bg-fd-accent transition-colors"
            >
              GitHub
            </a>
            <Link
              href="/playground"
              className="rounded-lg border border-fd-border bg-fd-card px-6 py-3 text-sm font-medium text-fd-foreground hover:bg-fd-accent transition-colors"
            >
              Playground
            </Link>
            <a
              href="https://github.com/IntersectMBO/evolution-sdk/blob/main/packages/evolution/CHANGELOG.md"
              className="rounded-lg border border-fd-border bg-fd-card px-6 py-3 text-sm font-medium text-fd-foreground hover:bg-fd-accent transition-colors"
            >
              Changelog
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-fd-border">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-fd-muted-foreground">
            MIT Licensed • Built by{" "}
            <a href="https://github.com/no-witness-labs/" className="text-fd-foreground hover:text-fd-primary">
              No Witness Labs
            </a>{" "}
            under{" "}
            <a href="https://intersectmbo.org/" className="text-fd-foreground hover:text-fd-primary">
              Intersect MBO
            </a>
          </p>
          <div className="flex gap-6">
            <a
              href="https://github.com/IntersectMBO/evolution-sdk"
              className="text-sm text-fd-muted-foreground hover:text-fd-foreground"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/39xMk9DwQv"
              className="text-sm text-fd-muted-foreground hover:text-fd-foreground"
            >
              Discord
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
