/**
 * An `IssuerBackend` built from Evolution itself — no Rust attachment, no new dependency.
 *
 * ⚠️ **Deep-import only, like `Issuer`.** This module is not re-exported from `index.ts`, so
 * nothing that imports the package barrel can pull it into a React-Native bundle. The reason is
 * narrower than it used to be: the apply-params and hashing halves here are pure TypeScript and
 * would be harmless in a bundle, but `evalTx` needs a Plutus VM, which is a WASM evaluator a
 * phone has no business carrying.
 *
 * WHY IT EXISTS. `Issuer` takes its backend injected because the deploy-time work used to need
 * an isolated Rust attachment (`cip113_apply_params`, `cip113_plutus_script_hash_v3`,
 * `cip113_eval_tx`) that was never part of this repository, which left every ex-units number in
 * `Budgets.ts` with a provenance nobody here could reproduce. Everything it did is available in
 * this package's own dependencies:
 *
 * | the attachment did | this does |
 * |---|---|
 * | `cip113_apply_params` | `UPLC.applyParamsToScript`, whose encoding matches `aiken blueprint apply` |
 * | `cip113_plutus_script_hash_v3` | `ScriptHash.fromScript` over a `PlutusV3`, i.e. blake2b-224 of `0x03 ‖ script` |
 * | `cip113_eval_tx` | an INJECTED Evolution `Evaluator` — `@evolution-sdk/aiken-uplc`'s `createAikenEvaluator` is one |
 *
 * The evaluator is injected rather than imported so this module adds no dependency and no WASM
 * to the package; the measurement harness wires Aiken's in.
 *
 * @since 0.1.0
 */

import {
  Bytes,
  CBOR,
  CostModel,
  Data,
  PlutusV3,
  Redeemer,
  Script,
  ScriptHash,
  Transaction,
  TransactionInput,
  TxOut,
  UPLC,
  UTxO,
} from "@evolution-sdk/evolution"
import type * as TransactionBuilder from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import { Effect, Layer } from "effect"

import type { IssuerBackend, RedeemerCost } from "./Issuer.js"
import { IssuerError, IssuerTag } from "./Issuer.js"

/**
 * Apply pre-encoded Plutus-data parameters to a blueprint script.
 *
 * ⚠️ The result is SINGLE CBOR-encoded, because that is what a witness set carries and what the
 * hash is taken over. `UPLC.applyParamsToScript` answers DOUBLE-encoded, and handing that to a
 * builder puts one CBOR layer too many in the witness set: the node then hashes the wrapper, gets
 * a hash matching nothing the transaction requires, and rejects it as **"missing required
 * script"** — a message that names neither the script nor the extra layer. Measured, on the first
 * run of the budgets harness.
 */
export const applyParams = (scriptHex: string, paramDataHexes: ReadonlyArray<string>): Effect.Effect<string, IssuerError> =>
  Effect.try({
    try: () =>
      UPLC.applySingleCborEncoding(
        UPLC.applyParamsToScript(scriptHex, paramDataHexes.map((hex) => Data.fromCBORHex(hex)))
      ),
    catch: (e) => new IssuerError({ reason: `applyParams: ${e instanceof Error ? e.message : String(e)}` }),
  })

/**
 * Plutus V3 script hash (the script credential / policy id) of a `compiledCode`-form script.
 *
 * The hash is over `0x03 ‖ <the script bytes the witness set carries>`, which is ONE CBOR layer
 * inside the double-encoded form — so the hex is normalised to double encoding and one layer is
 * stripped. ⚠️ Hashing the wrong layer yields a real, well-formed hash of the wrong thing: the
 * same bytes single-encoded hash to something else entirely, and an address derived from it
 * resolves and holds nothing.
 */
export const scriptHashV3 = (scriptHex: string): Effect.Effect<string, IssuerError> =>
  Effect.try({
    try: () => {
      // ⚠️ An EMPTY script hashes perfectly happily — `''` wraps to the CBOR bytestring `40` and
      // comes back as a real-looking 28-byte policy id. It is reachable: a `Deployment` derived
      // through `alwaysFailHashHex` records `applied.alwaysFail = ''`, and hashing that would
      // answer with the hash of nothing instead of saying there is no script.
      if (scriptHex.length === 0) throw new Error("empty script")
      const doubled = UPLC.applyDoubleCborEncoding(scriptHex)
      const bytes = CBOR.fromCBORBytes(Bytes.fromHex(doubled))
      if (!(bytes instanceof Uint8Array)) throw new Error("script is not a CBOR bytestring")
      if (bytes.length === 0) throw new Error("empty script")
      return Bytes.toHex(ScriptHash.fromScript(new PlutusV3.PlutusV3({ bytes })).hash)
    },
    catch: (e) => new IssuerError({ reason: `scriptHashV3: ${e instanceof Error ? e.message : String(e)}` }),
  })

/**
 * One UTxO, from the `(input CBOR, output CBOR)` hex pair `IssuerBackend.evalTx` takes.
 *
 * ⚠️ The pair shape is the VM's, not Evolution's: the WASM evaluator takes two parallel arrays,
 * and that is what the earlier attachment's wrapper exposed. Keeping it means a caller that
 * already has wire bytes does not have to rebuild typed values for them to be re-serialised —
 * and it is why the decode happens here, once, rather than in each harness.
 */
const utxoOf = ([inputHex, outputHex]: readonly [string, string]): UTxO.UTxO => {
  const input = TransactionInput.fromCBORHex(inputHex)
  const output = TxOut.fromCBORHex(outputHex)
  return new UTxO.UTxO({
    transactionId: input.transactionId,
    index: input.index,
    address: output.address,
    assets: output.assets,
    ...(output.datumOption === undefined ? {} : { datumOption: output.datumOption }),
    ...(output.scriptRef === undefined ? {} : { scriptRef: Script.fromCBOR(output.scriptRef.bytes) }),
  })
}

/**
 * Build the issuer backend over Evolution, with `evalTx` delegated to `evaluator`.
 *
 * `evaluator` is Evolution's own `Evaluator` seam — `@evolution-sdk/aiken-uplc`'s
 * `createAikenEvaluator` satisfies it — so this module needs no WASM and no dependency of its
 * own. Omit it for the derivation-only path (deriving a deployment, deriving a token policy):
 * `evalTx` then fails with a reason naming the omission rather than pretending to measure.
 */
export const uplcBackend = (evaluator?: TransactionBuilder.Evaluator): IssuerBackend => ({
  applyParams,
  scriptHashV3,
  evalTx: (args) =>
    Effect.gen(function* () {
      if (evaluator === undefined) {
        return yield* Effect.fail(
          new IssuerError({ reason: "evalTx: uplcBackend was built without an evaluator; pass one to measure ex-units" })
        )
      }
      const prepared = yield* Effect.try({
        try: () => ({
          tx: Transaction.fromCBORHex(args.txHex),
          utxos: args.utxos.map(utxoOf),
          // ⚠️ No fallback for absent cost models. An empty model set evaluates every builtin at
          // zero, so the VM answers with costs of 0 and the budget derived from them is rejected
          // by the node — a measurement that looks like a cheap script.
          costModels: CostModel.fromCBORHex(
            args.costModelsHex ?? (() => {
              throw new Error("costModelsHex is required: an absent cost model measures every script as free")
            })()
          ),
        }),
        catch: (e) => new IssuerError({ reason: `evalTx: ${e instanceof Error ? e.message : String(e)}` }),
      })
      const rows = yield* evaluator
        .evaluate(prepared.tx, prepared.utxos, {
          costModels: prepared.costModels,
          maxTxExSteps: args.maxSteps,
          maxTxExMem: args.maxMem,
          slotConfig: { zeroTime: args.slot[0], zeroSlot: args.slot[1], slotLength: args.slot[2] },
        })
        .pipe(
          Effect.mapError((e) => {
            // ⚠️ The per-script failures, not just `e.message`. Aiken's top-level message is
            // "UPLC evaluation failed", which names neither the script nor the reason — the one
            // opaque failure this package's error type exists to avoid.
            const detail = (e.failures ?? [])
              .map((f) => `${f.purpose}(${f.index}): ${f.validationError}`)
              .join("; ")
            return new IssuerError({ reason: `evalTx: ${e.message}${detail === "" ? "" : ` — ${detail}`}` })
          })
        )
      return rows.map((row): RedeemerCost => ({
        // ⚠️ Through `tagToInteger`, because Evolution models the tag as a STRING literal
        // (`"spend"` / `"reward"` / …) while `RedeemerCost.tag` is the CDDL integer every caller
        // filters on. `Number("reward")` is `NaN`, which matches no filter, so a measurement
        // would quietly find no rows at all rather than fail.
        tag: Number(Redeemer.tagToInteger(row.redeemer_tag)),
        index: row.redeemer_index,
        mem: BigInt(row.ex_units.mem),
        steps: BigInt(row.ex_units.steps),
      }))
    }),
})

/** The backend as a Layer, for `Effect.provide`. @since 0.1.0 */
export const uplcBackendLayer = (evaluator?: TransactionBuilder.Evaluator): Layer.Layer<IssuerTag> =>
  Layer.succeed(IssuerTag, uplcBackend(evaluator))
