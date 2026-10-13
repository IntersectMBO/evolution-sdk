// CIP-113 transfer execution budgets — measured, not guessed.
//
// Every Plutus script run in a transaction must declare a mem/steps budget up front:
// underestimate and the transaction is invalid, overestimate and the sender overpays.
// Producing those numbers normally means evaluating the transaction against a Plutus VM,
// which a React-Native device cannot do (no wasm) — see the backend table in `exunits.ts`,
// where `presets` exists for exactly this case.
//
// So the numbers are measured once, offline, against a deployment derived from upstream's own
// blueprint, and recorded here with their provenance. `harness/budgets.ts` IS that measurement:
// it re-derives every record and fails if the presets no longer reproduce it, so an upstream cost
// change shows up as a failing run rather than as a rejected transaction.
//
//   pnpm --filter @evolution-sdk/cip113 run budgets
//   CIP113_VERSION=v0.5.0-alpha.2 pnpm --filter @evolution-sdk/cip113 run budgets
//
// A measurement is NOT portable across deployments — the scripts differ — so `deploymentId`
// records which one it describes, and a redeploy invalidates it.
//
// ⚠️ What is still missing is a measurement of a LIVE deployment over the network: these are
// derived from upstream's blueprint, so the validator bytes and therefore the SLOPES are real
// while the intercept carries the fabricated transaction's shape. That is what the margin in
// `transferBudgets` is for, and it is not a substitute for measuring the chain you submit to.
//
// ── what is NOT here, deliberately ──────────────────────────────────────────────
// The substandard's `transfer_logic` budget. That script is written by the token's issuer,
// its cost varies per issuer and per holder (an allowlist walk is not a constant), and
// nothing here can predict it. A preset for it would be a fabrication that fails closed on
// the user's transaction. Callers supply substandard budgets; this module covers the two
// framework scripts, which are the same for everyone.

import { applyMargin, type ExUnits } from "@evolution-sdk/plan/ExUnits"

/** Measured budgets for the framework scripts of one deployment. */
export interface TransferMeasurement {
  /** Which deployment these were measured against — they are not portable across
   *  deployments, because the scripts themselves differ. */
  readonly deploymentId: string
  /** ISO date of the measurement, and how it was produced. */
  readonly measuredAt: string
  readonly source: string
  /** `programmable_logic_base` spend, per PLB input. Constant in every shape measured. */
  readonly plbSpendPerInput: ExUnits
  /**
   * The `programmable_logic_global` DISPATCHER's withdraw-0, where the shape has one
   * (`0.5.0-alpha.4`). Absent on every earlier shape, and that absence is the point: the
   * dispatcher is a THIRD framework script in the transaction, so a budget computed from a
   * pre-alpha.4 measurement has no slot for it at all.
   *
   * Flat — it resolves one hash baked into its own identity and checks one withdrawal — and
   * `harness/budgets.ts` asserts the flatness rather than assuming it.
   */
  readonly plgDispatch?: ExUnits
  /** The transfer withdraw-0 delegate at zero inputs AND zero outputs (the intercept).
   *  That delegate is `transfer` on `LATEST` and `programmable_logic_global` on the
   *  pre-split shapes — same position in the transaction, same budget slot. */
  readonly transferBase: ExUnits
  /** Delegate marginal cost per PLB input. */
  readonly transferPerInput: ExUnits
  /**
   * Delegate marginal cost per PLB **output**.
   *
   * ⚠️ Its own axis, and it did not exist until 2026-08-16. Every shape had been measured with
   * one output per input, so this was folded invisibly into `transferPerInput` — and the first
   * transfer to break that ratio underspent its budget and was rejected by the node.
   */
  readonly transferPerOutput: ExUnits
}

/**
 * Budgets for `Cip113.V0_5_0_ALPHA_2` — the PLB-dispatch shape of upstream `9db7e06`, which CF's
 * preview instance ran until 2026-09-28.
 *
 * Kept although no shipped record names that shape any more: its budgets are for different
 * scripts and it has no dispatcher term, so anything reading the superseded instance must pass
 * THIS record rather than the one `measurementFor(LATEST)` returns.
 *
 * PROVENANCE: a deployment DERIVED from `9db7e06`'s blueprint and evaluated on the local Plutus
 * VM. The validator bytes and therefore the SLOPES are real; the intercept carries whatever the
 * fabricated transaction's shape implies.
 *
 * Raw observations (no margin), transfers of one policy, in mem:
 *
 * | PLB in / out | PLB spend / input | transfer delegate |
 * |-------------:|------------------:|------------------:|
 * |     1 in 1 out |            66,404 |           208,527 |
 * |     2 in 1 out |            66,404 |           254,842 |
 * |     3 in 1 out |            66,404 |           307,975 |
 * |     4 in 1 out |            66,404 |           361,108 |
 * |     1 in 2 out |            66,404 |           257,514 |
 * |     1 in 3 out |            66,404 |           306,501 |
 * |     1 in 4 out |            66,404 |           355,488 |
 *
 * ⚠️ THE PER-INPUT SLOPE IS NOT CONSTANT AT THE FIRST INPUT: the 1→2 step is 46,315 and every
 * step after it is 53,133, because `assets.collect` creates the policy entry on the first PLB
 * input and pays a `tokens.union` merge on each subsequent one. So the fit anchors the
 * ASYMPTOTIC slope at the 1-input shape, which is exact there and over-estimates by 6,818 mem
 * at four inputs. Anchoring the other way round under-budgets the narrow shapes — the failure
 * mode this module exists to prevent.
 */
export const REFERENCE_ALPHA2_MEASUREMENT: TransferMeasurement = {
  deploymentId: 'reference-main-9db7e06',
  measuredAt: '2026-08-27',
  source: 'harness/budgets.ts (local Plutus VM; deployment derived from upstream main@9db7e06; reproduced 2026-10-11)',
  plbSpendPerInput: { mem: 66_404n, steps: 21_898_390n },
  transferBase: { mem: 106_407n, steps: 41_395_292n },
  transferPerInput: { mem: 53_133n, steps: 18_121_386n },
  transferPerOutput: { mem: 48_987n, steps: 17_660_498n },
}

/** @deprecated Ambiguous now that "main" has meant three shapes in a month. This is the
 *  `0.5.0-alpha.2` record — use `REFERENCE_ALPHA2_MEASUREMENT`, or `REFERENCE_ALPHA4_MEASUREMENT`
 *  if what you wanted was "whatever `Cip113.LATEST` is". */
export const REFERENCE_MAIN_MEASUREMENT: TransferMeasurement = REFERENCE_ALPHA2_MEASUREMENT

/**
 * Budgets for the PLG-dispatcher shape of upstream `7e8a631` (`0.5.0-alpha.4`) — and for
 * `Cip113.LATEST` (`v0.0.1`, upstream `6b75ba3`), whose transfer-path scripts are
 * byte-identical to it (see `measurementFor`).
 *
 * PROVENANCE, and it matters: nothing is deployed on this shape, so these come from a
 * deployment DERIVED from `main`'s blueprint and evaluated on the local Plutus VM
 * (`harness/budgets.ts`, which re-derives them on every run and fails if they
 * drift). Re-measure against a real deployment before submitting on this shape.
 *
 * THREE framework scripts now, not two — the dispatcher's withdraw-0 joins every programmable
 * transaction. It is cheap and flat, but it is a redeemer that needs a budget, and a caller
 * still on the alpha.2 record has no field to put one in.
 *
 * Both older scripts got CHEAPER, which is #117 doing what it was for:
 *
 *   - PLB per input 66,404 → 50,707 mem. It no longer decodes the params datum to choose
 *     between three delegates; it reads ONE credential at field 0, where the accessor is a
 *     bare `head_list` with no `tail_list` walk.
 *   - the transfer delegate's intercept 106,407 → 71,740 mem. It stopped reading the params
 *     datum entirely — `programmable_logic_base_cred`, `registry_node_cs` and the datum bound
 *     are compile-time parameters now.
 *
 * The per-input and per-output SLOPES are unchanged to the unit (53,133 and 48,987 mem), which
 * is the expected result: #117 removed fixed work, not per-item work, and the same
 * `assets.collect` / `tokens.union` behaviour drives both axes. The first-input step is still
 * the cheap one, so the fit still anchors the asymptotic slope at the narrowest shape.
 *
 * The dispatcher is not free, so the savings must be netted rather than quoted: at 1 in / 1 out
 * the framework costs 50,707 + 28,289 + 173,860 = **252,856 mem**, against 66,404 + 208,527 =
 * 274,931 on alpha.2 — about 8% cheaper. The gap widens with inputs, because the dispatcher is
 * paid ONCE per transaction while PLB's 15,697-mem saving is paid per input.
 */
export const REFERENCE_ALPHA4_MEASUREMENT: TransferMeasurement = {
  deploymentId: 'reference-main-7e8a631',
  measuredAt: '2026-09-13',
  source: 'harness/budgets.ts (local Plutus VM; deployment derived from upstream main@7e8a631; reproduced 2026-10-11)',
  plbSpendPerInput: { mem: 50_707n, steps: 17_605_251n },
  plgDispatch: { mem: 28_289n, steps: 12_050_953n },
  transferBase: { mem: 71_740n, steps: 30_017_955n },
  transferPerInput: { mem: 53_133n, steps: 18_121_386n },
  transferPerOutput: { mem: 48_987n, steps: 17_660_498n },
}

/**
 * `v0.0.1`, measured 2026-10-02 — and it is NOT the alpha.4 record, which is the interesting part.
 *
 * 33 of 34 validators are byte-identical across `7e8a631` → `6b75ba3`,
 * and that a transfer touches the one that moved (`protocol_params`) only as a reference input.
 * The conclusion drawn from that — same scripts, so same numbers — does not survive measurement:
 *
 *   plbSpendPerInput  50,707 → 53,475 mem   (+5.5%)
 *   transferBase      71,740 → 72,441 mem   (+1.0%)
 *   plgDispatch       28,289 → 25,891 mem   (-8.5%)
 *   transferPerInput  53,133 → 53,133       unchanged to the unit
 *   transferPerOutput 48,987 → 48,987       unchanged to the unit
 *
 * Every FIXED term moved and both SLOPES did not, which is the signature of identical code over
 * different data rather than of changed code. The likely mechanism — stated as a hypothesis, not a
 * finding, because nobody has instrumented it — is that `protocol_params` moving its hash moves
 * every hash derived from it, and byte-ordered structures (asset maps, reference-input scans) do a
 * different number of comparisons when a key sorts to a different position. Same length, same
 * script, different step count, in both directions.
 *
 * The practical lesson is narrower and certain: **byte-identical scripts do not imply identical
 * ex-units.** A derived measurement belongs to the deployment it was derived from.
 *
 * Nothing was at risk in the interim: `transferBudgets`' ×1.2 margin covered the drift with 13.8%
 * to spare at the worst point, and the harness's own coverage assertions passed throughout.
 */
export const REFERENCE_V0_0_1_MEASUREMENT: TransferMeasurement = {
  deploymentId: 'reference-main-6b75ba3',
  measuredAt: '2026-10-02',
  source: 'harness/budgets.ts (local Plutus VM; deployment derived from upstream main@6b75ba3; reproduced 2026-10-11)',
  plbSpendPerInput: { mem: 53_475n, steps: 18_421_671n },
  plgDispatch: { mem: 25_891n, steps: 10_074_700n },
  transferBase: { mem: 72_441n, steps: 31_355_451n },
  transferPerInput: { mem: 53_133n, steps: 18_121_386n },
  transferPerOutput: { mem: 48_987n, steps: 17_660_498n },
}

/**
 * The measurement matching a schema version, or `undefined` when we have none for it.
 *
 * Keyed on the version rather than the deployment id because the scripts are what the numbers
 * describe, and two deployments of the same revision run the same scripts. It is still an
 * approximation for a real instance — a deployment's own measurement, taken over the network by
 * a live-deployment measurement, beats a derived one — but it is the right default
 * shape, and `undefined` is an honest answer for a version nobody has measured.
 */
export const measurementFor = (version: { readonly id: string }): TransferMeasurement | undefined => {
  switch (version.id) {
    // It stopped being true. The scripts ARE byte-identical bar `protocol_params`, and the
    // numbers still moved — see `REFERENCE_V0_0_1_MEASUREMENT`. Each version carries its own.
    case 'v0.0.1':
      return REFERENCE_V0_0_1_MEASUREMENT
    case 'v0.5.0-alpha.4':
      return REFERENCE_ALPHA4_MEASUREMENT
    case 'v0.5.0-alpha.2':
      return REFERENCE_ALPHA2_MEASUREMENT
    default:
      return undefined
  }
}

/** Conway's per-transaction execution limits (mainnet/preview alike at time of writing).
 *  Held here so a budget can be reported as over-limit instead of failing at submit. */
export const TX_EXECUTION_LIMITS: ExUnits = { mem: 14_000_000n, steps: 10_000_000_000n }

/** The budgets one transfer needs. */
export interface TransferBudgets {
  /** Budget for EACH PLB spend redeemer. */
  readonly plbSpend: ExUnits
  /** Budget for the single transfer withdraw-0 reward redeemer. */
  readonly transferDelegate: ExUnits
  /** Budget for the dispatcher's withdraw-0, where the measurement has one. `undefined` on
   *  pre-`0.5.0-alpha.4` shapes, which have no such redeemer to budget. */
  readonly plgDispatch?: ExUnits
  /** Framework total for this shape (excludes substandards — see the module header). */
  readonly frameworkTotal: ExUnits
  /** True when `frameworkTotal` alone already exceeds the per-transaction limit, before
   *  any substandard has been accounted for. Split the transfer instead. */
  readonly exceedsTxLimit: boolean
}

/**
 * Budgets for a transfer spending `plbInputCount` smart-wallet UTxOs, with a safety margin
 * (default +20%) over the measured base.
 *
 * The margin absorbs data-dependent variation the measurement could not cover — different
 * asset counts per UTxO, datums present, a longer registry proof. It is not a substitute
 * for measuring against the deployment you are actually transacting on.
 *
 * `measurement` is REQUIRED — it used to default to "whatever `Cip113.LATEST` is", and that
 * default became a live under-budget the moment upstream moved: `0.5.0-alpha.4` made both
 * framework scripts cheaper, so alpha.4 numbers applied to CF's alpha.2 deployment produce a
 * budget the node rejects, margin and all (PLB 50,707 × 1.2 = 60,848 against an actual 66,404).
 * Nothing about that failure is visible at build time. `measurementFor(deployment.version)`
 * picks the right record; a compile error here is the intended cost of removing the default. Pass your
 * own record when transacting on a deployment whose scripts differ — the numbers are not
 * portable, and a redeploy is exactly such a difference.
 */
export const transferBudgets = (
  plbInputCount: number,
  plbOutputCount: number,
  measurement: TransferMeasurement,
  margin: readonly [bigint, bigint] = [12n, 10n],
): TransferBudgets => {
  if (!Number.isInteger(plbInputCount) || plbInputCount < 1) {
    throw new Error(`plbInputCount must be a positive integer, got ${plbInputCount}`)
  }
  // Required rather than defaulted to the input count. That default is precisely the assumption
  // that shipped a transaction the node rejected, and it would have failed silently again.
  if (!Number.isInteger(plbOutputCount) || plbOutputCount < 1) {
    throw new Error(`plbOutputCount must be a positive integer, got ${plbOutputCount}`)
  }
  const n = BigInt(plbInputCount)
  const outs = BigInt(plbOutputCount)
  const plbSpend = applyMargin(measurement.plbSpendPerInput, margin)
  const delegateRaw: ExUnits = {
    mem: measurement.transferBase.mem + measurement.transferPerInput.mem * n + measurement.transferPerOutput.mem * outs,
    steps: measurement.transferBase.steps + measurement.transferPerInput.steps * n + measurement.transferPerOutput.steps * outs,
  }
  const transferDelegate = applyMargin(delegateRaw, margin)
  const plgDispatch = measurement.plgDispatch === undefined ? undefined : applyMargin(measurement.plgDispatch, margin)
  const frameworkTotal: ExUnits = {
    mem: plbSpend.mem * n + transferDelegate.mem + (plgDispatch?.mem ?? 0n),
    steps: plbSpend.steps * n + transferDelegate.steps + (plgDispatch?.steps ?? 0n),
  }
  return {
    plbSpend,
    transferDelegate,
    ...(plgDispatch !== undefined ? { plgDispatch } : {}),
    frameworkTotal,
    exceedsTxLimit: frameworkTotal.mem > TX_EXECUTION_LIMITS.mem || frameworkTotal.steps > TX_EXECUTION_LIMITS.steps,
  }
}

/**
 * The largest number of PLB inputs whose FRAMEWORK cost still fits the per-transaction
 * limit. A real transfer also pays for its substandards, so treat this as an upper bound
 * rather than a target — pass `reserve` to hold budget back for them.
 *
 * `outputsPerInput` is what each extra input is expected to cost in outputs. 1 is the
 * consolidating case (many holdings, one recipient); a transfer that also returns a remainder
 * produces one more output than that, which `transferBudgets` charges for.
 */
export const maxPlbInputsPerTx = (
  measurement: TransferMeasurement,
  margin: readonly [bigint, bigint] = [12n, 10n],
  reserve: ExUnits = { mem: 0n, steps: 0n },
  outputsPerInput = 1,
): number => {
  let n = 0
  for (;;) {
    const next = n + 1
    const b = transferBudgets(next, Math.max(1, Math.ceil(next * outputsPerInput)), measurement, margin)
    if (b.frameworkTotal.mem + reserve.mem > TX_EXECUTION_LIMITS.mem) return n
    if (b.frameworkTotal.steps + reserve.steps > TX_EXECUTION_LIMITS.steps) return n
    n = next
    if (n > 1000) return n // pathological guard; no real transfer approaches this
  }
}
