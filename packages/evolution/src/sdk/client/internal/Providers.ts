import * as Blockfrost from "../../provider/Blockfrost.js"
import * as Koios from "../../provider/Koios.js"
import * as Kupmios from "../../provider/Kupmios.js"
import * as Maestro from "../../provider/Maestro.js"
import type { Provider } from "../../provider/Provider.js"
import type { BlockfrostConfig, KoiosConfig, KupmiosConfig, MaestroConfig } from "../Client.js"

// ── Blockfrost ────────────────────────────────────────────────────────────────
export const blockfrost = (config: BlockfrostConfig): Provider => Blockfrost.custom(config.baseUrl, config.projectId)

// ── Koios ─────────────────────────────────────────────────────────────────────
export const koios = (config: KoiosConfig): Provider => new Koios.Koios(config.baseUrl, config.token)

// ── Kupmios ───────────────────────────────────────────────────────────────────
export const kupmios = (config: KupmiosConfig): Provider =>
  new Kupmios.KupmiosProvider(config.kupoUrl, config.ogmiosUrl, config.headers)

// ── Maestro ───────────────────────────────────────────────────────────────────
export const maestro = (config: MaestroConfig): Provider =>
  new Maestro.MaestroProvider(config.baseUrl, config.apiKey, config.turboSubmit)
