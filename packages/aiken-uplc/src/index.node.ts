/**
 * Node.js entry point - uses synchronous WASM initialization via initSync
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs"

import { makeEvaluator } from "./Evaluator.js"
import { eval_phase_two_raw,initSync } from "./web/aiken_uplc.js"

// Initialize WASM synchronously using the .wasm file from disk
const wasmPath = new URL("./web/aiken_uplc_bg.wasm", import.meta.url)
initSync({ module: readFileSync(wasmPath) })

/**
 * Create an Aiken UPLC evaluator for Evolution SDK (Node.js).
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
export const createAikenEvaluator = makeEvaluator({ eval_phase_two_raw })
