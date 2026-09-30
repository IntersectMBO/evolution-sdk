/**
 * Browser entry point - uses bundler WASM target
 *
 * Bundlers (Webpack, Vite) handle the `.wasm` import automatically via
 * `--target bundler` output. No explicit init() call needed.
 *
 * @packageDocumentation
 */

import * as wasmModule from "./bundler/aiken_uplc.js"
import { makeEvaluator } from "./Evaluator.js"

/**
 * Create an Aiken UPLC evaluator for Evolution SDK (Browser).
 *
 * This evaluator provides local UPLC script evaluation using Aiken's evaluator
 * compiled to WASM, enabling offline transaction building and testing without
 * requiring a provider connection.
 *
 * **Benefits:**
 * - No network dependency (works offline)
 * - Privacy (transaction never leaves local environment)
 * - Performance (no network latency)
 * - Deterministic evaluation for testing
 *
 * @example
 * ```typescript
 * import { makeTxBuilder } from "@evolution-sdk/evolution"
 * import { createAikenEvaluator } from "@evolution-sdk/aiken-uplc"
 *
 * const builder = makeTxBuilder({ wallet, provider })
 *
 * const tx = await builder
 *   .collectFrom([scriptUtxo], redeemer)
 *   .attachScript({ script: validatorScript })
 *   .payToAddress({ address: recipientAddr, assets })
 *   .build({
 *     evaluator: createAikenEvaluator
 *   })
 * ```
 */
export const createAikenEvaluator = makeEvaluator(wasmModule)
