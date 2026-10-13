// Ex-units evaluation seam — how a Plutus tx's `mem`/`steps` budgets are produced
// before submit. Every script run must declare an ex-units budget in
// its redeemer: underestimate → invalid tx, overestimate → overpay. The budget is
// PER TRANSACTION (it scales with the tx shape), so whatever produces the numbers
// runs per build. Declared ex-units are NOT in the ScriptContext, so a
// build→evaluate→rebuild loop is stable — the only question is what backs the numbers.
//
// This is a swappable service (`ExUnitsTag`) with interchangeable backends, chosen per
// environment:
//   - `callerSupplied` — the app already knows the units (cached / measured); escape hatch.
//   - `presets`        — measured base units + a safety margin; NO network, NO VM. The
//                        React-Native path, where wasm cannot run and a pure-TS Plutus VM
//                        is out of scope.
//   - `providerEval`   — an Ogmios/Blockfrost `evaluateTransaction` adapter (online
//                        fallback for arbitrary txs; Koios has no evaluate endpoint).
//
// A `local-wasm-VM` backend is not implemented as a Layer HERE — but the capability
// EXISTS in this repo and is the cheapest way to produce `presets`. The CIP-113 issuer
// attachment (`cores/rust/attachments/cip113`) binds aiken's `uplc` and exposes
// `eval_tx` / `cip113_eval_tx`: a GENERIC `eval_phase_two_raw` over any transaction —
// tx CBOR + resolved UTxOs + cost models + slot config, none of it CIP-113-specific
// despite where it lives. `harness/cip113-transfer-exunits.mjs` drives it against a live
// deployment using Koios alone.
//
// Said plainly because the previous wording ("not implemented here") was read as "we
// have no evaluator", which put a second provider on a critical path it does not belong
// on. Measuring locally and shipping the numbers as `presets` needs no
// evaluate endpoint. It IS CLI/desktop-only — wasm doesn't run on RN — which is exactly
// why the device consumes presets rather than evaluating.
//
//   const units = yield* (yield* ExUnits.ExUnitsTag).evaluate({ redeemers })
//   // feed `units` into Plan redeemers / Cip113.buildTransferTx before the final build.

import { NonnegativeInterval } from "@evolution-sdk/evolution"
import { Context, Data, Effect, Layer } from "effect"

/** A redeemer pointer — which script run in the tx. tag: 0=spend 1=mint 2=cert 3=reward 4=vote 5=propose. */
export interface RedeemerKey {
  readonly tag: number
  readonly index: number
}

/** A Plutus execution budget. */
export interface ExUnits {
  readonly mem: bigint
  readonly steps: bigint
}

/** Stable string key for a redeemer pointer (map key). */
export const ptrKey = (k: RedeemerKey): string => `${k.tag}:${k.index}`

/** Evaluation failed — no preset/entry for a redeemer, provider error, or malformed tx. */
export class EvalError extends Data.TaggedError("EvalError")<{ readonly reason: string }> {}

/** What to price: the redeemers present in the tx, plus optionals some backends need. */
export interface EvalTarget {
  /** The redeemers to price (order as they appear in the tx). Used by `presets`/`callerSupplied`. */
  readonly redeemers: ReadonlyArray<RedeemerKey>
  /** The built (draft) transaction CBOR — required by `providerEval` / VM backends. */
  readonly txHex?: string
  /** Extra UTxOs the evaluating node needs to resolve inputs (provider-specific). */
  readonly additionalUtxosHex?: string
}

export interface ExUnitsEvaluator {
  /** Price every redeemer in `target` → a map keyed by `ptrKey(...)`. */
  readonly evaluate: (target: EvalTarget) => Effect.Effect<ReadonlyMap<string, ExUnits>, EvalError>
}

/** The ex-units service tag. Provide `callerSupplied` / `presets` / `providerEval`. */
export class ExUnitsTag extends Context.Tag("@evolution-sdk/ExUnits")<ExUnitsTag, ExUnitsEvaluator>() {}

/** Apply a `[num, den]` safety margin to a budget, rounding each component UP. */
export const applyMargin = (u: ExUnits, [num, den]: readonly [bigint, bigint]): ExUnits => ({
  mem: NonnegativeInterval.ceilDiv(u.mem * num, den),
  steps: NonnegativeInterval.ceilDiv(u.steps * num, den)
})

const toMap = (entries: Iterable<readonly [RedeemerKey, ExUnits]>): Map<string, ExUnits> => {
  const m = new Map<string, ExUnits>()
  for (const [k, v] of entries) m.set(ptrKey(k), v)
  return m
}

/**
 * The app supplies exact units it already holds (e.g. cached from a prior on-chain
 * evaluation). Every redeemer in the target MUST have an entry, or evaluation fails.
 */
export const callerSupplied = (entries: Iterable<readonly [RedeemerKey, ExUnits]>): Layer.Layer<ExUnitsTag> => {
  const table = toMap(entries)
  return Layer.succeed(ExUnitsTag, {
    evaluate: ({ redeemers }) =>
      Effect.gen(function* () {
        const out = new Map<string, ExUnits>()
        for (const r of redeemers) {
          const u = table.get(ptrKey(r))
          if (!u) return yield* Effect.fail(new EvalError({ reason: `no ex-units supplied for redeemer ${ptrKey(r)}` }))
          out.set(ptrKey(r), u)
        }
        return out
      })
  })
}

/**
 * Offline-measured base units + a safety margin — the RN/pure-ts path. Measure each
 * substandard's cost once (e.g. against a preprod Ogmios/Blockfrost), record the base
 * per redeemer pointer, and apply `margin` (default +20%, `[12,10]`) to absorb
 * data-dependent variation. NO network, NO Plutus VM. Every target redeemer must have
 * a base entry.
 */
export const presets = (
  base: Iterable<readonly [RedeemerKey, ExUnits]>,
  margin: readonly [bigint, bigint] = [12n, 10n]
): Layer.Layer<ExUnitsTag> => {
  if (margin[1] === 0n) throw new Error("presets margin denominator must be non-zero")
  const table = toMap(base)
  return Layer.succeed(ExUnitsTag, {
    evaluate: ({ redeemers }) =>
      Effect.gen(function* () {
        const out = new Map<string, ExUnits>()
        for (const r of redeemers) {
          const b = table.get(ptrKey(r))
          if (!b) return yield* Effect.fail(new EvalError({ reason: `no preset ex-units for redeemer ${ptrKey(r)}` }))
          out.set(ptrKey(r), applyMargin(b, margin))
        }
        return out
      })
  })
}

/**
 * Online fallback: adapt a provider's transaction-evaluation endpoint (Ogmios
 * `evaluateTransaction` / Blockfrost `/utils/txs/evaluate`; Koios has none). The app
 * supplies `evalTx`, which takes the draft tx CBOR (+ any additional UTxOs) and returns
 * one result per redeemer. The library stays transport-agnostic — the app owns the HTTP.
 */
export const providerEval = (
  evalTx: (txHex: string, additionalUtxosHex?: string) => Promise<ReadonlyArray<RedeemerKey & ExUnits>>
): Layer.Layer<ExUnitsTag> =>
  Layer.succeed(ExUnitsTag, {
    evaluate: ({ additionalUtxosHex, txHex }) =>
      Effect.gen(function* () {
        if (txHex === undefined)
          return yield* Effect.fail(new EvalError({ reason: "providerEval requires target.txHex (the draft tx)" }))
        const results = yield* Effect.tryPromise({
          try: () => evalTx(txHex, additionalUtxosHex),
          catch: (e) => new EvalError({ reason: e instanceof Error ? e.message : String(e) })
        })
        return toMap(
          results.map(
            (r) =>
              [
                { tag: r.tag, index: r.index },
                { mem: r.mem, steps: r.steps }
              ] as const
          )
        )
      })
  })

/** Resolve the units for one redeemer pointer from an evaluation result, or fail. */
export const unitsFor = (units: ReadonlyMap<string, ExUnits>, key: RedeemerKey): Effect.Effect<ExUnits, EvalError> => {
  const u = units.get(ptrKey(key))
  return u ? Effect.succeed(u) : Effect.fail(new EvalError({ reason: `no ex-units for redeemer ${ptrKey(key)}` }))
}
