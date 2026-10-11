/**
 * The plan engine: declarative intent in, a balanced and signed transaction out.
 *
 * A `CardanoPlan` is intent (outputs, certificates, withdrawals, signers). Each *plugin* turns
 * one slice of that into a `Contribution` (extra outputs, certificates, withdrawals, required
 * signers, a deposit delta). The engine merges contributions, then runs one value-aware
 * balancer: select inputs covering (outputs + fee + deposits - withdrawals), emit
 * token-preserving change, iterate the fee to a fixed point over the SERIALIZED size, sign.
 *
 * Plan-as-data rather than a fluent builder, because a plan can be reviewed before it is signed.
 *
 * Hex strings are the working representation throughout: the fee is a fixed point over the
 * serialized size, so bytes are what the engine computes on. Callers holding their own branded
 * hex types pass them straight in.
 *
 * @since 0.1.0
 */
import { Address, Assets, Fees, InlineDatum, MinAda, NonnegativeInterval, type Provider, ScriptRef, TxOut, Value } from "@evolution-sdk/evolution"
import { Data } from "effect"

import * as Encode from "./internal/Encode.js"

/**
 * This engine's `[numerator, denominator]` pair as the ledger's own non-negative rational.
 *
 * Both sides are exact; this is a change of spelling, not of value.
 */
const interval = (fraction: readonly [bigint, bigint]): NonnegativeInterval.NonnegativeInterval =>
  new NonnegativeInterval.NonnegativeInterval({ numerator: fraction[0], denominator: fraction[1] })

export interface ProtocolParams {
  readonly minFeeA: bigint
  readonly minFeeB: bigint
  readonly coinsPerUtxoByte: bigint
  /** stake-key registration deposit (refundable). */
  readonly keyDeposit: bigint
  /** stake-pool registration deposit (refundable). */
  readonly poolDeposit: bigint
  /** DRep registration deposit (Conway; refundable). */
  readonly drepDeposit: bigint
  // ── Plutus fee inputs (only consumed when the plan carries redeemers) ──
  /** script execution price for memory, as a `[num, den]` fraction. */
  readonly priceMem?: readonly [bigint, bigint]
  /** script execution price for CPU steps, as a `[num, den]` fraction. */
  readonly priceStep?: readonly [bigint, bigint]
  /** reference-script fee base rate (lovelace/byte), as a `[num, den]` fraction. */
  readonly minFeeRefScriptCostPerByte?: readonly [bigint, bigint]
  /** Conway collateral percentage (e.g. 150) — enables auto collateral selection. */
  readonly collateralPercentage?: number
  /** max collateral inputs the engine may select. */
  readonly maxCollateralInputs?: number
  /** flattened Plutus V3 cost model (251 ints) — for the script_data_hash + fee. */
  readonly plutusV3CostModel?: ReadonlyArray<bigint>
  /** max serialized value size (bytes) — Conway sizing bound. */
  readonly maxValueSize?: bigint
  /**
   * max serialized tx size (bytes) — Conway sizing bound.
   *
   * Optional: absent means the build performs no size check, which is what every
   * existing `staticParamsLayer` caller gets until it supplies one.
   */
  readonly maxTxSize?: bigint
}

/**
 * Evolution's protocol parameters to this engine's.
 *
 * ⚠️ **Two real conversions, not a rename.** Theirs are `number` where the fee arithmetic needs
 * `bigint`, and the execution prices are IEEE doubles where these are exact `[num, den]`
 * fractions — `0.0577` has no binary representation, and rounding it into a fee is how a
 * transaction comes back under-paid by a lovelace and is rejected.
 *
 * It lives here, with the type it produces, so a caller holding a chain client can reach the
 * engine without a provider adapter in between. `NonnegativeInterval.fromDecimal` reads a
 * `number` through its shortest round-tripping decimal, which recovers the decimal that was
 * written rather than the double it became.
 *
 * @since 0.1.0
 */
/**
 * A keyed cost model to the positional array the script-data hash and the fee are computed over.
 *
 * ⚠️ **Read back by the ORIGINAL key, never by one rebuilt from the number.** `String(1)` cannot
 * round-trip a `"01"` entry: it looks up a key that is not there and `BigInt(undefined)` throws
 * from inside a conversion — a defect rather than the parameter error it is. Such a key is
 * refused now, and so is a non-integer cost: a cost model with a hole in it produces a wrong
 * script-data hash, which the ledger rejects after the user has signed.
 *
 * The sort is deliberately belt-and-braces rather than load-bearing — every key the guard above
 * admits is a canonical integer index, which JavaScript enumerates in ascending numeric order
 * anyway. It stays so that the order of a POSITIONAL array does not rest on an engine
 * enumeration rule a reader would have to go and look up.
 */
const flattenCostModel = (model: Record<string, number>): ReadonlyArray<bigint> => {
  const entries = Object.keys(model).map((key) => {
    if (!/^(0|[1-9][0-9]*)$/.test(key.trim())) {
      throw new InvalidParamsError("plutusV3CostModel", `has a non-index key "${key}"`)
    }
    const value = model[key] as number
    if (!Number.isInteger(value)) {
      throw new InvalidParamsError("plutusV3CostModel", `entry ${key} is not an integer: ${value}`)
    }
    return [Number(key.trim()), BigInt(value)] as const
  })
  entries.sort(([a], [b]) => a - b)
  return entries.map(([, value]) => value)
}

export const paramsFromProtocolParameters = (p: Provider.ProtocolParameters): ProtocolParams => {
  const fraction = (value: number): readonly [bigint, bigint] => {
    const interval = NonnegativeInterval.fromDecimal(value)
    return [interval.numerator, interval.denominator]
  }
  const plutusV3 = p.costModels.PlutusV3
  return {
    minFeeA: BigInt(p.minFeeA),
    minFeeB: BigInt(p.minFeeB),
    coinsPerUtxoByte: p.coinsPerUtxoByte,
    keyDeposit: p.keyDeposit,
    poolDeposit: p.poolDeposit,
    drepDeposit: p.drepDeposit,
    priceMem: fraction(p.priceMem),
    priceStep: fraction(p.priceStep),
    minFeeRefScriptCostPerByte: fraction(p.minFeeRefScriptCostPerByte),
    collateralPercentage: p.collateralPercentage,
    maxCollateralInputs: p.maxCollateralInputs,
    maxValueSize: BigInt(p.maxValSize),
    maxTxSize: BigInt(p.maxTxSize),
    ...(Object.keys(plutusV3).length > 0 ? { plutusV3CostModel: flattenCostModel(plutusV3) } : {})
  }
}

/**
 * Thrown when protocol params violate a STRUCTURAL invariant. Deliberately not a
 * plausibility check: every parameter here is governance-mutable (Conway made
 * parameter changes a vote, not a hard fork), and `coins_per_utxo_word` →
 * `coins_per_utxo_byte` in Babbage already redefined one of these units ~8×. A
 * magnitude ceiling calibrated to today's values would eventually reject a
 * legitimate protocol change and stop every caller from building any
 * transaction — a worse outcome than the attack it guards against.
 *
 * So we only reject what NO parameter change can legitimately produce: negative
 * magnitudes, and a zero denominator. Magnitude abuse is bounded at the *outcome*
 * instead — see {@link MAX_DUST_FOLD_LOVELACE} and {@link FeeBreakdown}, which
 * are policies about the user's funds rather than facts about the protocol, and
 * therefore never go stale.
 */
export class InvalidParamsError extends Error {
  readonly _tag = "InvalidParamsError"
  constructor(field: string, detail: string) {
    super(`protocol params: ${field} ${detail}`)
  }
}

const assertStructuralParams = (p: ProtocolParams): void => {
  const nonNegative: ReadonlyArray<readonly [string, bigint | undefined]> = [
    ["minFeeA", p.minFeeA],
    ["minFeeB", p.minFeeB],
    ["coinsPerUtxoByte", p.coinsPerUtxoByte],
    ["keyDeposit", p.keyDeposit],
    ["poolDeposit", p.poolDeposit],
    ["drepDeposit", p.drepDeposit],
    ["maxValueSize", p.maxValueSize],
    ["maxTxSize", p.maxTxSize]
  ]
  for (const [name, v] of nonNegative) {
    if (v !== undefined && v < 0n) throw new InvalidParamsError(name, `must be non-negative, got ${v}`)
  }
  const fractions: ReadonlyArray<readonly [string, readonly [bigint, bigint] | undefined]> = [
    ["priceMem", p.priceMem],
    ["priceStep", p.priceStep],
    ["minFeeRefScriptCostPerByte", p.minFeeRefScriptCostPerByte]
  ]
  for (const [name, f] of fractions) {
    if (f === undefined) continue
    const [num, den] = f
    if (den <= 0n) throw new InvalidParamsError(name, `denominator must be positive, got ${den}`)
    if (num < 0n) throw new InvalidParamsError(name, `numerator must be non-negative, got ${num}`)
  }
  const counts: ReadonlyArray<readonly [string, number | undefined]> = [
    ["collateralPercentage", p.collateralPercentage],
    ["maxCollateralInputs", p.maxCollateralInputs]
  ]
  for (const [name, n] of counts) {
    if (n === undefined) continue
    if (!Number.isInteger(n) || n < 0) throw new InvalidParamsError(name, `must be a non-negative integer, got ${n}`)
  }
}

/**
 * The most ADA the balancer may silently reclassify as fee when change falls
 * below min-ada (the "dust fold"). An ABSOLUTE constant on purpose: deriving it
 * from `coinsPerUtxoByte` would inherit that parameter's trust, and it is exactly
 * the value an attacker (or a units regression) inflates to make the fold
 * swallow a whole balance. Legitimate dust at real parameters is ≲1 ADA.
 */
export const MAX_DUST_FOLD_LOVELACE = 2_000_000n

/** Thrown when the dust fold would exceed {@link MAX_DUST_FOLD_LOVELACE}. */
export class ExcessiveFeeFoldError extends Error {
  readonly _tag = "ExcessiveFeeFoldError"
  constructor(readonly amount: bigint) {
    super(
      `refusing to fold ${amount} lovelace of change into the fee (cap ${MAX_DUST_FOLD_LOVELACE}); ` +
        "this usually means coinsPerUtxoByte is wrong or the params source is untrusted"
    )
  }
}

/**
 * Thrown when the converged transaction exceeds the protocol's `maxTxSize`.
 *
 * Raised only when `maxTxSize` is supplied, and only at convergence: size moves
 * transiently while coin selection grows the input set, so an intermediate
 * measurement is not meaningful. `overBy` is what a caller needs to decide how
 * much intent to move to another leg.
 */
export class TxTooLargeError extends Error {
  readonly _tag = "TxTooLargeError"
  readonly overBy: bigint
  constructor(
    readonly size: number,
    readonly limit: bigint
  ) {
    super(`transaction is ${size} bytes, over the ${limit}-byte limit by ${BigInt(size) - limit}`)
    this.overBy = BigInt(size) - limit
  }
}

/**
 * Thrown when a single output's value exceeds the protocol's `maxValueSize`.
 *
 * Conway bounds the serialized `Value` of one output as well as the whole
 * transaction, and the two fail differently: a transaction that is too large can
 * be split into more transactions, whereas a *value* that is too large has to be
 * split across more **outputs**. A consolidation that folds many assets into one
 * output hits this bound, not `maxTxSize`.
 *
 * `outputIndex` indexes the transaction's outputs, so the change output — always
 * appended last — reports `plan.outputs.length`.
 */
export class ValueTooLargeError extends Error {
  readonly _tag = "ValueTooLargeError"
  readonly overBy: bigint
  constructor(
    readonly size: number,
    readonly limit: bigint,
    readonly outputIndex: number
  ) {
    super(`output ${outputIndex} value is ${size} bytes, over the ${limit}-byte limit by ${BigInt(size) - limit}`)
    this.overBy = BigInt(size) - limit
  }
}

/**
 * Thrown when auto-collateral cannot emit a collateral-return output (the return would
 * fall below min-ada) and the forfeited excess would exceed
 * {@link MAX_DUST_FOLD_LOVELACE}. Supply explicit `plutus.collateral` inputs sized
 * closer to the requirement, or a UTxO whose remainder clears min-ada.
 */
export class ExcessiveCollateralError extends Error {
  readonly _tag = "ExcessiveCollateralError"
  constructor(
    readonly forfeit: bigint,
    readonly required: bigint
  ) {
    super(
      `auto-collateral would commit ${forfeit} lovelace above the required ${required} with no ` +
        `collateral-return output (cap ${MAX_DUST_FOLD_LOVELACE}); that excess is forfeited if the script fails`
    )
  }
}

/**
 * Where the fee went. Cardano's value-conservation rule (`consumed = produced`)
 * makes every other mis-accounting self-correct into a rejected transaction, so
 * the fee field is the only unchecked sink — which makes this breakdown the thing
 * a caller needs to bound by policy.
 *
 * Reported, never enforced (beyond {@link MAX_DUST_FOLD_LOVELACE}): a legitimate
 * multi-script Plutus tx can genuinely cost several ADA, so a library-side fee
 * ceiling would reject real transactions. Policy belongs above this layer.
 */
export interface FeeBreakdown {
  /** `minFeeA * size + minFeeB`. */
  readonly linear: bigint
  /** Conway ex-unit fee over every redeemer's mem/steps. */
  readonly scriptExecution: bigint
  /** Conway tiered reference-script fee. */
  readonly refScript: bigint
  /** Sub-min-ada change folded in rather than emitted as an output. */
  readonly foldedFromChange: bigint
  /** The fee actually written to the body — the sum of the above. */
  readonly total: bigint
  /** Coin sent to the plan's own outputs (change excluded); the ratio denominator. */
  readonly sentCoin: bigint
}

/**
 * Fee as a percentage of the coin actually sent, or undefined when nothing is
 * sent (a consolidation / self-transfer, where the ratio is meaningless). A
 * ratio scales with the transaction instead of with the protocol, so unlike an
 * absolute ceiling it survives parameter changes — but it misreads legitimately
 * fee-dominated transactions, which is why this reports rather than rejects.
 */
export const feePercentOfSent = (b: FeeBreakdown): number | undefined =>
  b.sentCoin === 0n ? undefined : Number((b.total * 10_000n) / b.sentCoin) / 100

/** A value-carrying UTxO available to spend. */
export interface PlanInput {
  readonly txHash: string
  readonly index: number
  readonly assets: Assets.Assets
}

/** A requested output: the value to send to `addressHex`. */
export interface PlanOutput {
  readonly addressHex: string
  readonly assets: Assets.Assets
  /** optional inline datum (raw plutus_data CBOR hex) — emits a Babbage output. */
  readonly datumHex?: string
  /** optional reference script (raw script CBOR hex). */
  readonly scriptRefHex?: string
}

export interface PlanWithdrawal {
  readonly rewardAcctHex: string
  readonly amount: bigint
}

/** A mint/burn instruction: `assetId` = "policyHex.nameHex"; amount signed (− = burn). */
export interface PlanMint {
  readonly assetId: string
  readonly amount: bigint
  /**
   * The minting policy's NATIVE script (hex) — added to the witness set. Pass `''`
   * (empty) for a PLUTUS minting policy: the script is then supplied via
   * `plutus.scriptsV{1,2,3}` and authorized by a mint redeemer (tag 1) whose
   * `mintPolicyHex` resolves its index against the canonical mint-map order.
   */
  readonly policyScriptHex: string
}

export interface PlanRedeemer {
  readonly tag: number // 0=spend,1=mint,2=cert,3=reward,4=voting,5=proposing
  readonly index: bigint
  readonly dataHex: string // plutus_data CBOR
  readonly mem: bigint
  readonly steps: bigint
  /**
   * For a spend redeemer (tag 0): the outpoint being unlocked. When set, the
   * engine resolves `index` to that outpoint's position in the final canonical
   * input ordering (the literal `index` is ignored). Omit to use `index`
   * verbatim (single-input / caller-ordered cases).
   */
  readonly spendOutpoint?: { readonly txHash: string; readonly index: number }
  /**
   * For a mint redeemer (tag 1): the policy id being minted/burned. When set, the
   * engine resolves `index` to that policy's position in the canonical (byte-sorted)
   * mint-map order — the same order `encodeMint` emits. The literal `index` is ignored.
   */
  readonly mintPolicyHex?: string
  /**
   * For a reward redeemer (tag 3): the reward account (hex) being withdrawn — e.g. the
   * CIP-113 PLG withdraw-zero account. When set, the engine resolves `index` to that
   * account's position in the canonical (byte-sorted) withdrawals order (which the engine
   * also emits the withdrawals map in). The literal `index` is ignored.
   */
  readonly withdrawalRewardAcctHex?: string
}
/** Plutus witnesses + the derived script_data_hash + collateral/reference inputs. */
export interface PlanPlutus {
  readonly scriptsV1?: ReadonlyArray<string>
  readonly scriptsV2?: ReadonlyArray<string>
  readonly scriptsV3?: ReadonlyArray<string>
  readonly datums?: ReadonlyArray<string> // plutus_data CBOR hexes
  readonly redeemers?: ReadonlyArray<PlanRedeemer>
  readonly costModels?: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
  readonly collateral?: ReadonlyArray<{ readonly txHash: string; readonly index: number }>
  readonly referenceInputs?: ReadonlyArray<{ readonly txHash: string; readonly index: number }>
  /**
   * Total byte size of the scripts supplied via `referenceInputs`, for the
   * Conway reference-script fee. Required (with `minFeeRefScriptCostPerByte`)
   * to fee a reference-script spend correctly.
   */
  readonly referenceScriptsSize?: number
}

export interface CardanoPlan {
  readonly inputs: ReadonlyArray<PlanInput>
  /** Inputs that are ALWAYS spent (e.g. a script UTxO) — never dropped by coin
   * selection; the selectable remainder is drawn from `inputs`. */
  readonly mandatoryInputs?: ReadonlyArray<PlanInput>
  readonly outputs: ReadonlyArray<PlanOutput>
  readonly changeAddressHex: string
  readonly params: ProtocolParams
  /**
   * Refuse to fold ADA-only dust change into the fee; take another input instead.
   *
   * ⚠️ **For a chained run, and it is not a preference.** Payment *n+1* spends payment *n*'s
   * unconfirmed change, so a leg whose change was folded away leaves the next leg nothing to chain
   * onto — the chain silently stops after one. With this set the balancer grows the input set until
   * the change clears its own min-ADA, and fails with {@link InsufficientError} when it cannot,
   * which is the honest answer: this wallet cannot produce a chainable change output right now.
   */
  readonly requireChange?: boolean
  /** pre-encoded certificate hexes (from the Certs facade). */
  readonly certificates?: ReadonlyArray<string>
  readonly withdrawals?: ReadonlyArray<PlanWithdrawal>
  /** net deposit this tx pays (e.g. + key/pool deposit; a refund is negative). */
  readonly deposit?: bigint
  /** mint/burn instructions (native-script policies). */
  readonly mint?: ReadonlyArray<PlanMint>
  /** arbitrary raw body-map entries [key, CBOR-value-hex] (validity=8, network-id=15, …). */
  readonly bodyExtra?: ReadonlyArray<readonly [number, string]>
  /** native scripts to include in the witness set (e.g. multisig/mint policies). */
  readonly nativeScripts?: ReadonlyArray<string>
  /** auxiliary_data CBOR (tx 4th element); sets aux_data_hash (body 7) automatically. */
  readonly auxiliaryDataHex?: string
  /** Plutus witnesses (scripts/datums/redeemers) + script_data_hash + collateral. */
  readonly plutus?: PlanPlutus
  /** xprv hexes that must sign. Distinct keys → distinct vkey witnesses. */
  readonly signers: ReadonlyArray<string>
  readonly ttl?: number
}

/** What a plugin adds to the tx. Merged across all plugins by the engine. */
export interface Contribution {
  readonly outputs: ReadonlyArray<string> // encoded output hexes
  readonly certificates: ReadonlyArray<string>
  readonly withdrawals: ReadonlyArray<PlanWithdrawal>
  readonly requiredSigners: ReadonlyArray<string>
  readonly depositDelta: bigint
  /** raw body-map entries [key, CBOR-value-hex] this plugin sets (e.g. mint=9). */
  readonly bodyExtra: ReadonlyArray<readonly [number, string]>
  /** raw witness-set map entries [key, CBOR-value-hex] (plutus scripts 3/6/7, datums 4, redeemers 5). */
  readonly witnessExtra: ReadonlyArray<readonly [number, string]>
  /** native scripts to add to the witness set. */
  readonly nativeScripts: ReadonlyArray<string>
  /** minted assets (positive), as (assetId, amount) — added to available value. */
  readonly mintPos: ReadonlyArray<readonly [string, bigint]>
  /** burned assets (positive magnitudes) — added to required value (consumed from inputs). */
  readonly mintNeg: ReadonlyArray<readonly [string, bigint]>
  /** auxiliary_data CBOR (the tx's 4th element). Empty = none. */
  readonly auxHex: string
}

const EMPTY: Contribution = {
  outputs: [],
  certificates: [],
  withdrawals: [],
  requiredSigners: [],
  depositDelta: 0n,
  bodyExtra: [],
  witnessExtra: [],
  nativeScripts: [],
  mintPos: [],
  mintNeg: [],
  auxHex: ""
}

/**
 * A plugin reads the plan and returns its contribution.
 *
 * ⚠️ It used to take a codec as a second argument, so that a second byte backend could be swapped
 * in. There is no second backend and nothing outside this package ever passed one; the engine
 * calls Evolution directly through `internal/Encode`.
 */
export type Plugin = (plan: CardanoPlan) => Contribution

// ---- the standard plugins (A2) ----

/** Requested outputs, encoded. No codec: the output is Evolution's `TxOut` now. */
export const sendPlugin: Plugin = (plan) => ({
  ...EMPTY,
  outputs: plan.outputs.map((o) => {
    return outputHex(o.addressHex, o.assets, o.datumHex, o.scriptRefHex)
  })
})

/** Certificates pass through; their deposit is declared on the plan. */
export const certificatesPlugin: Plugin = (plan) => ({
  ...EMPTY,
  certificates: plan.certificates ?? [],
  depositDelta: plan.deposit ?? 0n
})

export const withdrawalsPlugin: Plugin = (plan) => ({ ...EMPTY, withdrawals: plan.withdrawals ?? [] })

export const signersPlugin: Plugin = (plan) => ({ ...EMPTY, requiredSigners: plan.signers })

/** Mint/burn → mint field (9) + policy native scripts in the witness set. */
export const mintPlugin: Plugin = (plan) => {
  const mint = plan.mint ?? []
  if (mint.length === 0) return EMPTY
  const mintHex = Encode.mint(mint.map((m) => [m.assetId, m.amount] as const))
  // Native-script policies contribute their script here; a Plutus policy passes '' and
  // supplies its script + mint redeemer via the `plutus` field instead.
  const scripts = [...new Set(mint.map((m) => m.policyScriptHex).filter((s) => s.length > 0))]
  return {
    ...EMPTY,
    bodyExtra: [[9, mintHex]],
    nativeScripts: scripts,
    mintPos: mint.filter((m) => m.amount > 0n).map((m) => [m.assetId, m.amount] as const),
    mintNeg: mint.filter((m) => m.amount < 0n).map((m) => [m.assetId, -m.amount] as const)
  }
}

/** Pass-through raw body-extra + native scripts declared directly on the plan. */
export const rawPlugin: Plugin = (plan) => ({
  ...EMPTY,
  bodyExtra: plan.bodyExtra ?? [],
  nativeScripts: plan.nativeScripts ?? []
})

/** Auxiliary data → aux_data_hash (body 7) + the tx's 4th element. */
export const auxPlugin: Plugin = (plan) => {
  if (!plan.auxiliaryDataHex) return EMPTY
  const hash = Encode.auxiliaryDataHash(plan.auxiliaryDataHex)
  return { ...EMPTY, bodyExtra: [[7, Encode.byteString32(hash)]], auxHex: plan.auxiliaryDataHex }
}

/**
 * Plutus: scripts/datums/redeemers → witness-set fields (3/4/5/6/7), plus the
 * derived script_data_hash (body 11) and collateral(13)/reference(18) input sets.
 */
/**
 * Order reward accounts the way the LEDGER's `Map RewardAccount Coin` does — which is what
 * a tag-3 (Rewarding) redeemer pointer indexes, and what the Plutus script context's
 * withdrawal list is built from.
 *
 * `Ord RewardAccount` is network, then `Ord Credential`; `Credential`'s constructors are
 * `ScriptHashObj | KeyHashObj` in that order, so SCRIPT credentials sort BEFORE key
 * credentials, bytewise within each kind. The stake-address header carries the kind in bit
 * 4: `0xe…` = key, `0xf…` = script.
 *
 * This is deliberately NOT the canonical-CBOR order the withdrawals map is serialised in
 * (bytewise over the whole 29-byte account, where the `0xe…` key header sorts FIRST). The
 * two coincide whenever every withdrawal is the same kind — which is why the difference
 * stays invisible until a transaction mixes a script delegate with a signature-gated one.
 */
export const ledgerWithdrawalOrder = (rewardAcctHexes: ReadonlyArray<string>): Array<string> =>
  [...rewardAcctHexes].sort((a, b) => {
    const aScript = (parseInt(a.slice(0, 2), 16) & 0x10) !== 0
    const bScript = (parseInt(b.slice(0, 2), 16) & 0x10) !== 0
    if (aScript !== bScript) return aScript ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  })

export const needsRedeemerIndexResolution = (plan: CardanoPlan): boolean =>
  !!plan.plutus?.redeemers?.some(
    (r) => r.spendOutpoint !== undefined || r.mintPolicyHex !== undefined || r.withdrawalRewardAcctHex !== undefined
  )

export const plutusPlugin: Plugin = (plan) => {
  const p = plan.plutus
  if (!p) return EMPTY
  // When any spend redeemer carries a `spendOutpoint`, redeemers (5) and the
  // derived script_data_hash (11) depend on the final canonical input ordering,
  // which only `buildPlanCore` knows — it emits them in-loop. The scripts/datums
  // witness + reference inputs are order-independent and stay here.
  const deferRedeemers = needsRedeemerIndexResolution(plan)
  const witnessExtra: Array<readonly [number, string]> = []
  if (p.scriptsV1?.length) witnessExtra.push([3, Encode.plutusScripts(p.scriptsV1)])
  const datumsSetHex = p.datums?.length ? Encode.taggedSet(p.datums) : ""
  if (datumsSetHex) witnessExtra.push([4, datumsSetHex])
  let redeemersHex = ""
  if (!deferRedeemers && p.redeemers?.length) {
    redeemersHex = Encode.redeemers(p.redeemers)
    witnessExtra.push([5, redeemersHex])
  }
  if (p.scriptsV2?.length) witnessExtra.push([6, Encode.plutusScripts(p.scriptsV2)])
  if (p.scriptsV3?.length) witnessExtra.push([7, Encode.plutusScripts(p.scriptsV3)])

  const bodyExtra: Array<readonly [number, string]> = []
  if (!deferRedeemers && (redeemersHex || datumsSetHex)) {
    bodyExtra.push([11, Encode.byteString32(Encode.scriptDataHash(redeemersHex, datumsSetHex, p.costModels ?? []))])
  }
  const inputSet = (ins: ReadonlyArray<{ txHash: string; index: number }>) =>
    Encode.taggedSet(ins.map((i) => Encode.txInput(i.txHash, BigInt(i.index))))
  if (p.collateral?.length) bodyExtra.push([13, inputSet(p.collateral)])
  if (p.referenceInputs?.length) bodyExtra.push([18, inputSet(p.referenceInputs)])

  return { ...EMPTY, witnessExtra, bodyExtra }
}

export const DEFAULT_PLUGINS: ReadonlyArray<Plugin> = [
  sendPlugin,
  certificatesPlugin,
  withdrawalsPlugin,
  signersPlugin,
  mintPlugin,
  plutusPlugin,
  auxPlugin,
  rawPlugin
]

export class BuildError extends Data.TaggedError("BuildError")<{ readonly reason: string }> {}

/**
 * One change output a build emitted: where it landed, and what it holds.
 *
 * A list rather than a single `changeValueHex` + optional outpoint, because change
 * is split across several outputs when one cannot hold it (see `maxValueSize`).
 * The pair could be read without noticing the others existed; a list cannot.
 */
export interface ChangeOutput {
  readonly txHash: string
  readonly index: number
  readonly assets: Assets.Assets
}

export interface BuiltPlanTx {
  readonly signedTxHex: string
  readonly bodyHex: string
  readonly fee: bigint
  /** Where the fee went — bound this by policy (see {@link feePercentOfSent}). */
  readonly feeBreakdown: FeeBreakdown
  /** Every change output emitted, in body order. Empty when change folded into the fee. */
  readonly changeOutputs: ReadonlyArray<ChangeOutput>
  /**
   * Every input the transaction spends, in body order: `mandatoryInputs` first,
   * then the coin-selected remainder. Use this — not the plan's `inputs` — to
   * learn what was actually consumed.
   */
  readonly inputs: ReadonlyArray<PlanInput>
  /**
   * Serialized size (bytes) of the transaction actually returned — the number the
   * linear fee was computed from, so no caller needs to re-derive it.
   */
  readonly size: number
  /** The `maxTxSize` this build was checked against, when params supplied one. */
  readonly limit?: bigint
}

const DUMMY_SIG = "00".repeat(64)
const merge = (cs: ReadonlyArray<Contribution>): Contribution => ({
  outputs: cs.flatMap((c) => c.outputs),
  certificates: cs.flatMap((c) => c.certificates),
  withdrawals: cs.flatMap((c) => c.withdrawals),
  requiredSigners: cs.flatMap((c) => c.requiredSigners),
  depositDelta: cs.reduce((a, c) => a + c.depositDelta, 0n),
  bodyExtra: cs.flatMap((c) => c.bodyExtra),
  witnessExtra: cs.flatMap((c) => c.witnessExtra),
  nativeScripts: cs.flatMap((c) => c.nativeScripts),
  mintPos: cs.flatMap((c) => c.mintPos),
  mintNeg: cs.flatMap((c) => c.mintNeg),
  auxHex: cs.map((c) => c.auxHex).find((a) => a !== "") ?? ""
})

/**
 * Drop zero-quantity tokens.
 *
 * ⚠️ `Assets.subtract` is `merge(a, negate(b))` and `MultiAsset.addAsset` does not prune, so
 * exactly spending a token leaves a zero entry behind. A zero-quantity asset in an output is
 * invalid, and `Assets.hasMultiAsset` answers `true` for a bag that holds only one — which is why
 * {@link hasTokens} below asks `hasOnlyLovelace` instead.
 */
const pruneZeros = (a: Assets.Assets): Assets.Assets =>
  Assets.filter(a, (unit, amount) => unit === "lovelace" || amount !== 0n)

/** Whether a bag carries any token worth encoding. Zero-aware; `hasMultiAsset` is not. */
const hasTokens = (a: Assets.Assets): boolean => !Assets.hasOnlyLovelace(a)

/** A value's serialized length, which is what `maxValueSize` bounds. */
const valueSize = (a: Assets.Assets): number => {
  const pruned = pruneZeros(a)
  const multi = Assets.getMultiAsset(pruned)
  return Value.toCBORBytes(
    multi === undefined || !hasTokens(pruned) ? Value.onlyCoin(pruned.lovelace) : Value.withAssets(pruned.lovelace, multi)
  ).length
}

/**
 * An output of this engine's making.
 *
 * ⚠️ **`encodingFormat: "babbage"` is load-bearing.** Conway accepts both the Shelley array and
 * the Babbage map and a node takes either, but they are DIFFERENT BYTES — a different
 * transaction id, a different min-ada, and a different body for a hardware wallet to
 * reconstruct. Evolution's default picks Shelley unless a datum or script ref forces otherwise,
 * so omitting this would silently re-encode every output this engine has ever made.
 * `test/OutputBytes.test.ts` holds these bytes against the codec that used to produce them.
 *
 * ⚠️ The datum goes through `InlineDatum.fromCBORHex`, which RECORDS its arrival bytes: node
 * framing cannot express an EMPTY indefinite array, so `9fff` re-encodes as `80` without it.
 */
const outputOf = (
  addressHex: string,
  assets: Assets.Assets,
  datumHex?: string,
  scriptRefHex?: string
): TxOut.TransactionOutput =>
  new TxOut.TransactionOutput({
    address: Address.fromHex(addressHex),
    assets: pruneZeros(assets),
    encodingFormat: "babbage",
    ...(datumHex !== undefined ? { datumOption: InlineDatum.fromCBORHex(datumHex) } : {}),
    ...(scriptRefHex !== undefined ? { scriptRef: ScriptRef.fromHex(scriptRefHex) } : {})
  })

const outputHex = (addressHex: string, assets: Assets.Assets, datumHex?: string, scriptRefHex?: string): string =>
  TxOut.toCBORHex(outputOf(addressHex, assets, datumHex, scriptRefHex))

/** The smallest coin this output may carry, per the protocol's per-byte price. */
const minAdaOf = (addressHex: string, assets: Assets.Assets, coinsPerUtxoByte: bigint): bigint =>
  MinAda.forOutput(outputOf(addressHex, assets), coinsPerUtxoByte)

/** `(assetId, amount)` pairs to a bag, coin 0. */
const pairsToAssets = (pairs: ReadonlyArray<readonly [string, bigint]>): Assets.Assets =>
  Assets.fromRecord(Object.fromEntries([["lovelace", 0n], ...pairs.map(([id, n]) => [id, n] as const)]))

/** Fold (assetId, amount) pairs into a bag with coin 0. */
const assetsToValue = (pairs: ReadonlyArray<readonly [string, bigint]>): Assets.Assets => pairsToAssets(pairs)

interface PlanCoreResult {
  readonly bodyHex: string
  readonly fee: bigint
  readonly feeBreakdown: FeeBreakdown
  /** Every change output emitted, in body order. Empty when change folded into the fee. */
  readonly changeOutputs: ReadonlyArray<ChangeOutput>
  readonly inputs: ReadonlyArray<PlanInput>
  readonly nativeScripts: ReadonlyArray<string>
  readonly witnessExtra: ReadonlyArray<readonly [number, string]>
  readonly auxHex: string
  /**
   * Serialized size (bytes) of the transaction actually returned — the number the
   * linear fee was computed from, so no caller needs to re-derive it.
   */
  readonly size: number
  /** The `maxTxSize` this build was checked against, when params supplied one. */
  readonly limit?: bigint
}

function buildPlanCore(plan: CardanoPlan, plugins: ReadonlyArray<Plugin>): PlanCoreResult {
  const c = merge(plugins.map((p) => p(plan)))
  const p = plan.params
  assertStructuralParams(p)
  const ttlArg = plan.ttl === undefined ? undefined : BigInt(plan.ttl)

  const hasPlutus = !!plan.plutus?.redeemers?.length
  const resolveIdx = needsRedeemerIndexResolution(plan)
  const mandatory = plan.mandatoryInputs ?? []

  // Plutus fee components (fixed across the loop): ex-unit price + tiered
  // reference-script fee. Added on top of the linear size fee only when the
  // plan carries redeemers — otherwise the tx underpays and the node rejects it.
  let execFee = 0n
  let refFee = 0n
  if (hasPlutus) {
    const rs = plan.plutus?.redeemers ?? []
    const totalMem = rs.reduce((s, r) => s + r.mem, 0n)
    const totalSteps = rs.reduce((s, r) => s + r.steps, 0n)
    // The ledger's own fee components, from the one implementation of them. ⚠️ Exact rationals
    // on both sides of this boundary: a protocol price is a rational in the ledger, and this
    // engine carries it as a `[numerator, denominator]` pair for the same reason.
    if (p.priceMem && p.priceStep) {
      execFee = Fees.scriptExecutionFee(interval(p.priceMem), interval(p.priceStep), totalMem, totalSteps)
    }
    const refSize = BigInt(plan.plutus?.referenceScriptsSize ?? 0)
    if (refSize > 0n && p.minFeeRefScriptCostPerByte) {
      refFee = Fees.refScriptFee(refSize, interval(p.minFeeRefScriptCostPerByte))
    }
  }
  const plutusFee = execFee + refFee
  const linFee = (size: number): bigint => p.minFeeA * BigInt(size) + p.minFeeB + plutusFee

  // total value the outputs demand, and the withdrawal coin that becomes spendable
  let sendValue = Assets.zero
  for (const o of plan.outputs) sendValue = Assets.merge(sendValue, o.assets)
  const wdCoin = c.withdrawals.reduce((a, w) => a + w.amount, 0n)
  const mintPosValue = assetsToValue(c.mintPos)
  const mintNegValue = assetsToValue(c.mintNeg)
  // Deposits this tx pays (registration) go into `required`; deposits it refunds
  // (deregistration) are spendable value and go into `available`. Clamping the
  // refund to 0 would leave it unaccounted → a value-unbalanced tx the ledger rejects.
  const depositPay = c.depositDelta > 0n ? c.depositDelta : 0n
  const depositRefund = c.depositDelta < 0n ? -c.depositDelta : 0n

  // Value always available from mandatory inputs (script UTxOs never dropped).
  let mandatoryValue = Assets.zero
  for (const m of mandatory) mandatoryValue = Assets.merge(mandatoryValue, m.assets)

  // static body-map entries: certs(4), withdrawals(5), + plugin bodyExtra (mint=9,
  // sdh=11, ref-inputs=18, …). Redeemers(5)/sdh(11)/collateral are added in-loop
  // for the resolve-index / auto-collateral Plutus paths (they depend on the
  // final input order and the converged fee).
  // A body key set by two plugins used to emit a body with DUPLICATE keys, which
  // then got signed. Since the decoders now reject duplicate body keys, that also
  // meant emitting a body our own `TransactionBody.fromCborBytes` refuses to parse.
  // Catch the collision here, naming the key, instead of producing an unparseable body.
  const assertDistinctBodyKeys = (entries: ReadonlyArray<readonly [number, string]>): void => {
    const seen = new Set<number>()
    for (const [k] of entries) {
      if (seen.has(k)) {
        throw new Error(
          `two plugins both set transaction-body key ${k}; a body with duplicate keys is ` +
            "invalid CBOR and would be signed as-is (check for overlapping plugins, " +
            "e.g. a custom plugin plus `bodyExtra` on the plan)"
        )
      }
      seen.add(k)
    }
  }

  const staticExtras: Array<readonly [number, string]> = []
  if (c.certificates.length) staticExtras.push([4, Encode.taggedSet(c.certificates)])
  // Withdrawals form a map. Sort by reward-account bytes on encode so a caller need not
  // pre-sort and the map is canonical CBOR (bytewise over the encoded keys).
  //
  // ⚠️ This is NOT the order the tag-3 redeemer pointer resolves against — see
  // `ledgerWithdrawalOrder`. The two differ, and only for a transaction that mixes key-
  // and script-credential reward accounts.
  const sortedWithdrawals = [...c.withdrawals].sort((a, b) =>
    a.rewardAcctHex < b.rewardAcctHex ? -1 : a.rewardAcctHex > b.rewardAcctHex ? 1 : 0
  )
  if (sortedWithdrawals.length) {
    staticExtras.push([
      5,
      Encode.withdrawals(sortedWithdrawals.map((w) => [w.rewardAcctHex, w.amount] as const))
    ])
  }
  for (const [k, v] of c.bodyExtra) staticExtras.push([k, v])
  assertDistinctBodyKeys(staticExtras)
  const scripts = [...new Set(c.nativeScripts)]

  // distinct dummy signers so witness dedup doesn't collapse the fee estimate (G4)
  const signers = c.requiredSigners
  if (signers.length === 0) throw new Error("plan has no signers")
  const dvk = signers.map((_, i) => i.toString(16).padStart(2, "0") + "00".repeat(31))
  const dsg = signers.map(() => DUMMY_SIG)

  // largest-coin-first value ordering; grow the prefix until covered
  const sorted = [...plan.inputs].sort((a, b) =>
    Number(Assets.lovelaceOf(b.assets) - Assets.lovelaceOf(a.assets))
  )

  const autoCollateral = hasPlutus && !plan.plutus?.collateral?.length && p.collateralPercentage !== undefined
  const collateralPct = BigInt(p.collateralPercentage ?? 0)
  const maxColl = p.maxCollateralInputs ?? sorted.length
  const datumsSetHex = plan.plutus?.datums?.length ? Encode.taggedSet(plan.plutus.datums) : ""
  // Orderings the redeemer pointers index into — the order the LEDGER sees, which for
  // withdrawals is not the order the map is serialised in:
  //   reward (tag 3) → `ledgerWithdrawalOrder` (script credentials first);
  //   mint (tag 1)   → distinct mint policy ids sorted by bytes (as `encodeMint` emits).
  const withdrawalOrder = ledgerWithdrawalOrder(sortedWithdrawals.map((w) => w.rewardAcctHex))
  const mintPolicyOrder = [...new Set((plan.mint ?? []).map((m) => m.assetId.split(".")[0]!))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  )
  const encodeRedeemers = (ordered: ReadonlyArray<{ readonly txHash: string; readonly index: number }>): string => {
    const rs = plan.plutus?.redeemers ?? []
    const resolve = (r: PlanRedeemer): bigint => {
      if (r.spendOutpoint) {
        const i = ordered.findIndex((x) => x.txHash === r.spendOutpoint!.txHash && x.index === r.spendOutpoint!.index)
        return BigInt(i < 0 ? 0 : i)
      }
      if (r.mintPolicyHex !== undefined) return BigInt(Math.max(0, mintPolicyOrder.indexOf(r.mintPolicyHex)))
      if (r.withdrawalRewardAcctHex !== undefined)
        return BigInt(Math.max(0, withdrawalOrder.indexOf(r.withdrawalRewardAcctHex)))
      return r.index
    }
    return Encode.redeemers(rs.map((r) => ({ ...r, index: resolve(r) })))
  }
  const sdhOf = (redeemersHex: string): string =>
    Encode.scriptDataHash(redeemersHex, datumsSetHex, plan.plutus?.costModels ?? [])

  let take = Math.min(mandatory.length > 0 ? 0 : 1, sorted.length)
  let fee = 250_000n
  /** `linFee(0)` — no body can cost less, so no plan is unaffordable above it. */
  const feeFloor = p.minFeeB + plutusFee
  let descended = false
  // TWO budgets, not one. Both `take++` (grow the input set) and fee iteration used a
  // single 256-count guard via `continue`, so a wallet consolidating many small UTxOs
  // spent the whole budget on input growth and then failed with a misleading
  // "fee did not converge" — verified at ~276 inputs, with a solution available.
  // Input growth is bounded by the UTxO count and is monotonic; only fee iteration can
  // genuinely oscillate, so only it needs a tight cap.
  const MAX_FEE_ITERATIONS = 256
  let feeIterations = 0
  const maxTotal = sorted.length + MAX_FEE_ITERATIONS + 2
  for (let guard = 0; guard < maxTotal; guard++) {
    const selected = sorted.slice(0, take)
    // available = mandatory + selected inputs + withdrawals(coin) + minted(+) ; required = outputs + fee + deposit + burned(−)
    let available = Assets.merge(Assets.fromLovelace(wdCoin + depositRefund), mintPosValue)
    available = Assets.merge(available, mandatoryValue)
    for (const u of selected) available = Assets.merge(available, u.assets)
    const required = Assets.merge(Assets.merge(sendValue, mintNegValue), Assets.fromLovelace(fee + depositPay))

    if (!Assets.covers(available, required)) {
      if (take < sorted.length) {
        take++
        continue
      }
      // The starting fee is a seed, not a constraint. Refusing here reported
      // "insufficient funds" for a transaction the wallet can afford at its real
      // fee — every near-max send falls in the band between the two, and an exact
      // send-all (outputs absorb everything but the fee) never built at all. Drop
      // to the floor no body can go below and let the fixed point raise it back to
      // the truth; under-payment stays impossible because the loop only returns on
      // `newFee === fee`. Once, so an unaffordable plan still terminates.
      if (!descended && fee > feeFloor) {
        fee = feeFloor
        descended = true
        continue
      }
      throw new InsufficientError()
    }
    // A Plutus tx with auto-collateral needs a key-address (funding) input to
    // source collateral; force at least one whenever any is available.
    if (autoCollateral && selected.length === 0) {
      if (take < sorted.length) {
        take++
        continue
      }
      throw new InsufficientError()
    }

    const change = pruneZeros(Assets.subtract(available, required))
    const changeCoin = Assets.lovelaceOf(change)
    const changeTokens = hasTokens(change)

    // Final input ordering. Plutus paths canonically sort (by txHash then index)
    // so the redeemer pointer + the ledger-preferred order agree; non-Plutus keeps
    // the coin-selected order (byte-identical to the pre-hoist behaviour).
    const combined = [...mandatory, ...selected].map((u) => ({ txHash: u.txHash, index: u.index }))
    const orderedInputs = hasPlutus
      ? [...combined].sort((a, b) => (a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : a.index - b.index))
      : combined
    const inputHexes = orderedInputs.map((u) => Encode.txInput(u.txHash, BigInt(u.index)))

    // In-loop redeemers(5) + script_data_hash(11) for the resolve-index path.
    const dynWit: Array<readonly [number, string]> = []
    const dynBody: Array<readonly [number, string]> = []
    if (resolveIdx) {
      const redeemersHexOut = encodeRedeemers(orderedInputs)
      dynWit.push([5, redeemersHexOut])
      dynBody.push([11, Encode.byteString32(sdhOf(redeemersHexOut))])
    }
    const witEntries = [...c.witnessExtra, ...dynWit]
    /** The sizing transaction: dummy witnesses, so the fee covers the real ones. */
    const signedFor = (bodyHex: string, vkeyHexes: ReadonlyArray<string>, signatureHexes: ReadonlyArray<string>) =>
      Encode.signedTx({
        bodyHex,
        vkeyHexes,
        signatureHexes,
        nativeScriptHexes: scripts,
        witnessFields: witEntries,
        auxHex: c.auxHex
      })

    // The smallest coin an own-address output holding `assets` may carry. A fixed
    // point because raising the coin widens its own CBOR integer, which grows the
    // output and can raise the floor again; it settles in one or two rounds.
    const minAdaForAssets = (assets: ReadonlyArray<AssetAmount>): bigint => {
      let coin = 5_000_000n
      for (let round = 0; round < 4; round++) {
        const v = Assets.merge(Assets.fromLovelace(coin), pairsToAssets(assets.map((a) => [a.assetId, a.amount] as const)))
        const next = minAdaOf(plan.changeAddressHex, v, p.coinsPerUtxoByte)
        if (next === coin) return next
        coin = next
      }
      return coin
    }

    /**
     * Change as the value(s) of the output(s) it will occupy — several when one
     * cannot hold it.
     *
     * `null` means "emit no change output", i.e. the ADA-only dust fold. A thrown
     * `InsufficientError` (or the `take++` retry) means the change cannot reach
     * its own min-ADA and more inputs are needed.
     *
     * Splitting is what keeps a token-heavy wallet spendable at all: `maxValueSize`
     * bounds ONE output's value, and change carries every asset the inputs brought
     * that the outputs did not take. A wallet whose UTxOs hold more tokens than one
     * output may carry could otherwise never spend them — the build failed with
     * `ValueTooLargeError` and no arrangement of *recipients* could fix it, because
     * the overflow is on the change side.
     */
    const changeValues = (): ReadonlyArray<Assets.Assets> | null => {
      const limit = p.maxValueSize
      const fitsOneOutput = limit === undefined || BigInt(valueSize(change)) <= limit

      if (fitsOneOutput) {
        if (changeCoin >= minAdaOf(plan.changeAddressHex, change, p.coinsPerUtxoByte)) return [change]
        if (changeTokens) throw new InsufficientError()
        return null
      }

      // Over the per-output bound. Re-grouping needs the value's assets, which
      // only a codec that can enumerate them provides; without that, fall through
      // to the single output and let the bound below reject it as before.
      const assets = Assets.getUnits(change)
        .filter((u) => u !== "lovelace")
        .map((unit) => ({ assetId: unit, amount: Assets.getByUnit(change, unit) }))
      // Measured against the whole change coin: the primary output carries all the
      // leftover ADA, and a wider coin integer makes the value a byte or two
      // larger, so this keeps every group on the safe side of the bound.
      const { groups } = packAssetsByValueSizeSync(assets, limit, changeCoin)

      // Every group after the first gets its own output at exactly its floor; the
      // first also carries the leftover ADA, so the coin total is conserved and the
      // transaction still balances.
      const extras = groups.slice(1).map((g) => ({ assets: g, coin: minAdaForAssets(g) }))
      const reserved = extras.reduce((sum, e) => sum + e.coin, 0n)
      const primaryAssets = groups[0] ?? []
      const primaryCoin = changeCoin - reserved
      if (primaryCoin < minAdaForAssets(primaryAssets)) throw new InsufficientError()

      const encode = (coin: bigint, assetGroup: ReadonlyArray<AssetAmount>): Assets.Assets =>
        Assets.merge(Assets.fromLovelace(coin), pairsToAssets(assetGroup.map((a) => [a.assetId, a.amount] as const)))

      return [encode(primaryCoin, primaryAssets), ...extras.map((e) => encode(e.coin, e.assets))]
    }

    let outputHexes = [...c.outputs]
    let changeBags: ReadonlyArray<Assets.Assets> = []
    if (changeTokens || changeCoin > 0n) {
      let split: ReadonlyArray<Assets.Assets> | null
      try {
        split = changeValues()
      } catch (err) {
        // Not enough for change's own min-ADA: grow the input set before giving up.
        if (err instanceof InsufficientError && take < sorted.length) {
          take++
          continue
        }
        throw err
      }
      if (split === null) {
        // A caller that must chain cannot lose its change: grow the input set instead, and say so
        // plainly when there is nothing left to grow it with.
        // ADA-only dust → fold into fee (emit no change). Bounded: the floor
        // derives from the (possibly untrusted) coinsPerUtxoByte, so without a cap
        // an inflated parameter turns an entire balance into fee — and the ledger
        // accepts it, because Cardano has no maximum fee.
        if (changeCoin > MAX_DUST_FOLD_LOVELACE) throw new ExcessiveFeeFoldError(changeCoin)
      } else {
        changeBags = split
        outputHexes = [
          ...c.outputs,
          ...split.map((v) => outputHex(plan.changeAddressHex, v))
        ]
      }
    }

    // Auto-collateral picks (from the selected funding inputs) — fee-parameterized
    // so a dust-fold recomputes the collateral/return against the folded fee.
    const collateralExtras = (feeForCollateral: bigint): Array<readonly [number, string]> => {
      if (!autoCollateral) return []
      const requiredCollateral = NonnegativeInterval.ceilDiv(feeForCollateral * collateralPct, 100n)
      const picks: Array<PlanInput> = []
      let colAda = 0n
      for (const u of selected) {
        if (colAda >= requiredCollateral || picks.length >= maxColl) break
        picks.push(u)
        colAda += Assets.lovelaceOf(u.assets)
      }
      if (colAda < requiredCollateral) throw new InsufficientError()
      let colValue = Assets.zero
      for (const u of picks) colValue = Assets.merge(colValue, u.assets)
      const ret = pruneZeros(Assets.subtract(colValue, Assets.fromLovelace(requiredCollateral)))
      const retOut = outputHex(plan.changeAddressHex, ret)
      const emitRet = hasTokens(ret) || Assets.lovelaceOf(ret) >= minAdaOf(plan.changeAddressHex, ret, p.coinsPerUtxoByte)
      const entries: Array<readonly [number, string]> = [
        [13, Encode.taggedSet(picks.map((u) => Encode.txInput(u.txHash, BigInt(u.index))))]
      ]
      if (emitRet) {
        entries.push([16, retOut], [17, Encode.cborUint(requiredCollateral)])
      } else {
        // No return output ⇒ the WHOLE picked value is the collateral, so the excess
        // above `requiredCollateral` is forfeited if the script fails. Silently
        // over-committing the user's ADA is not ours to decide; bound it the way the
        // change fold is bounded rather than donating an unbounded amount.
        const forfeit = Assets.lovelaceOf(ret)
        if (forfeit > MAX_DUST_FOLD_LOVELACE) {
          throw new ExcessiveCollateralError(forfeit, requiredCollateral)
        }
      }
      return entries
    }

    const assemble = (outs: ReadonlyArray<string>, bodyFee: bigint, colFee: bigint): string => {
      const e = [...staticExtras, ...dynBody, ...collateralExtras(colFee)]
      assertDistinctBodyKeys(e) // dynBody (5/11) and collateral (13/16/17) must not collide either
      return Encode.body(inputHexes, [...outs], bodyFee, ttlArg, e)
    }

    const body = assemble(outputHexes, fee, fee)
    // sizing must include native scripts + the Plutus witness (redeemers) → fee
    const size = Encode.serializedSize(signedFor(body, dvk, dsg))
    const newFee = linFee(size)
    if (newFee !== fee && ++feeIterations > MAX_FEE_ITERATIONS) {
      throw new Error(`fee did not converge after ${MAX_FEE_ITERATIONS} iterations (oscillating size/fee)`)
    }
    if (newFee === fee) {
      const folded = changeBags.length === 0 && (changeCoin > 0n || changeTokens) ? changeCoin : 0n
      const foldedFee = fee + folded
      const finalBody = folded === 0n ? body : assemble(c.outputs, foldedFee, foldedFee)
      // Measure what we actually return, not what the fixed point measured. The
      // fold re-assembles the body with `foldedFee`, whose CBOR uint can be a
      // byte longer than `fee` — enough that the linear fee now exceeds what the
      // fold set aside, i.e. a marginal underpayment the ledger would reject.
      // Re-enter the loop at the higher fee rather than return an invalid tx;
      // MAX_FEE_ITERATIONS still bounds it.
      const finalSize =
        folded === 0n
          ? size
          : Encode.serializedSize(signedFor(finalBody, dvk, dsg))
      const finalFee = linFee(finalSize)
      if (finalFee > foldedFee) {
        fee = finalFee
        continue
      }
      // Per-output value bound, checked before the whole-transaction bound: a
      // caller that hits it must move assets to another *output*, which is a
      // different remedy from moving intent to another transaction.
      //
      // Covers the plan's own outputs and every change output. A plugin
      // contributing a pre-encoded output is not checked here — `Contribution`
      // carries encoded hexes, so its value is no longer separable — and among
      // the defaults only `sendPlugin` emits outputs, from `plan.outputs`.
      //
      // Change is split to stay under this bound, so reaching it now means a
      // single asset is too large to place anywhere, or the codec cannot
      // enumerate the value to split it. Both are real failures, not sizing.
      if (p.maxValueSize !== undefined) {
        const limit = p.maxValueSize
        plan.outputs.forEach((o, i) => {
          const vs = valueSize(o.assets)
          if (BigInt(vs) > limit) throw new ValueTooLargeError(vs, limit, i)
        })
        changeBags.forEach((v, i) => {
          const vs = valueSize(v)
          if (BigInt(vs) > limit) throw new ValueTooLargeError(vs, limit, c.outputs.length + i)
        })
      }
      if (p.maxTxSize !== undefined && BigInt(finalSize) > p.maxTxSize) {
        throw new TxTooLargeError(finalSize, p.maxTxSize)
      }
      // ⚠️ Checked HERE, on the settled build, and not inside the balancing loop. The loop starts
      // from a fee guess, and change that looks like dust against the guess is routinely fine against
      // the real fee — refusing mid-iteration rejected transactions the wallet could make. The
      // question "did this build end with change to chain onto" only has an answer at the end.
      if (plan.requireChange === true && folded !== 0n) {
        throw new InsufficientError(
          `this build folded ${folded} lovelace of change into the fee, and the plan requires a change output to chain onto`
        )
      }
      return {
        bodyHex: finalBody,
        fee: foldedFee,
        size: finalSize,
        ...(p.maxTxSize !== undefined ? { limit: p.maxTxSize } : {}),
        // Every change output this build emitted, with the index it actually
        // landed at — so a caller chaining onto change never has to assume where
        // it went, and never misses one when change had to be split. Empty when
        // change was folded into the fee: there is nothing to spend.
        changeOutputs:
          folded === 0n
            ? changeBags.map((assets, i) => ({
                txHash: Encode.bodyHash(finalBody),
                index: c.outputs.length + i,
                assets
              }))
            : [],
        // Every input the body actually spends, in body order — mandatory first,
        // then the coin-selected remainder, matching `combined` above.
        //
        // This used to report `selected` alone, silently omitting mandatory inputs.
        // A caller reading this to learn what the transaction consumes (registering
        // `consumedUtxoIds` with a chaining tracker, rendering a review screen,
        // reconciling a wallet's UTXO set) therefore got a WRONG answer for exactly
        // the plans that pin an input: a CIP-113 smart-wallet spend, a script UTxO,
        // or an x402 nonce. The nonce case is the sharpest — it is the one outpoint
        // whose reuse invalidates the next payment, and it was the one missing.
        inputs: [...mandatory, ...selected],
        nativeScripts: scripts,
        witnessExtra: witEntries,
        auxHex: c.auxHex,
        feeBreakdown: {
          linear: fee - plutusFee,
          scriptExecution: execFee,
          refScript: refFee,
          foldedFromChange: folded,
          total: foldedFee,
          sentCoin: Assets.lovelaceOf(sendValue)
        }
      }
    }
    fee = newFee
  }
  // Reaching here means input growth exhausted the budget rather than fee oscillation.
  throw new InsufficientError()
}

/**
 * The signed build against an explicitly supplied codec.
 *
 * @internal
 */
export function buildPlanSync(plan: CardanoPlan, plugins: ReadonlyArray<Plugin>): BuiltPlanTx {
  const r = buildPlanCore(plan, plugins)
  const hash = Encode.bodyHash(r.bodyHex)
  const vkeys = plan.signers.map((x) => Encode.vkeyOf(x))
  const sigs = plan.signers.map((x) => Encode.sign(x, hash))
  return {
    signedTxHex: Encode.signedTx({
      bodyHex: r.bodyHex,
      vkeyHexes: vkeys,
      signatureHexes: sigs,
      nativeScriptHexes: [...r.nativeScripts],
      witnessFields: r.witnessExtra,
      auxHex: r.auxHex
    }),
    bodyHex: r.bodyHex,
    fee: r.fee,
    feeBreakdown: r.feeBreakdown,
    changeOutputs: r.changeOutputs,
    inputs: r.inputs,
    size: r.size,
    ...(r.limit !== undefined ? { limit: r.limit } : {})
  }
}

/** Thrown by the balancer when inputs can't cover outputs+fee+deposit+collateral.
 *  Exported so callers running the sync build can map it to a domain error. */
export class InsufficientError extends Error {
  readonly _tag = "InsufficientError"
  constructor(detail?: string) {
    super(detail ?? "insufficient funds/assets to cover outputs + fee + deposit")
  }
}

/** A plan whose signing happens elsewhere (hardware / signing-service): no key
 * material, just how many distinct vkey witnesses the fee must budget for. */
export type UnsignedCardanoPlan = Omit<CardanoPlan, "signers"> & { readonly signerCount: number }

/** The unsigned build: the body plus the witness-set companions a signer/
 * assembler needs (matches the signing-service CardanoTx payload shape). */
export interface UnsignedPlanTx {
  readonly bodyHex: string
  readonly fee: bigint
  /** Where the fee went — bound this by policy (see {@link feePercentOfSent}). */
  readonly feeBreakdown: FeeBreakdown
  /** Every change output emitted, in body order. Empty when change folded into the fee. */
  readonly changeOutputs: ReadonlyArray<ChangeOutput>
  readonly inputs: ReadonlyArray<PlanInput>
  readonly nativeScripts: ReadonlyArray<string>
  readonly witnessExtra: ReadonlyArray<readonly [number, string]>
  readonly auxHex: string
  /**
   * Serialized size (bytes) of the transaction actually returned — the number the
   * linear fee was computed from, so no caller needs to re-derive it.
   */
  readonly size: number
  /** The `maxTxSize` this build was checked against, when params supplied one. */
  readonly limit?: bigint
}

/**
 * Build a transaction from a declarative plan WITHOUT signing — for wallets
 * whose keys live behind a signing service or hardware device. Fee sizing
 * budgets `signerCount` distinct vkey witnesses (same sizing as `buildPlan`,
 * which uses dummy keys until the final signature pass anyway).
 */
/**
 * Build and sign a transaction from a declarative plan.
 *
 * Throws `InsufficientError` when the inputs cannot cover outputs, fee and deposits, and
 * `TxTooLargeError` / `ValueTooLargeError` when a protocol limit is exceeded.
 *
 * @since 0.1.0
 * @category building
 */
export const build = (plan: CardanoPlan, plugins: ReadonlyArray<Plugin> = DEFAULT_PLUGINS): BuiltPlanTx =>
  buildPlanSync(plan, plugins)

/**
 * Build a transaction WITHOUT signing it, for wallets whose keys live behind a signing service or
 * a hardware device. The fee budgets `signerCount` distinct vkey witnesses, which is the same
 * sizing the signing path uses: it signs with dummy keys until the final pass anyway.
 *
 * @since 0.1.0
 * @category building
 */
export const buildUnsigned = (
  plan: UnsignedCardanoPlan,
  plugins: ReadonlyArray<Plugin> = DEFAULT_PLUGINS
): UnsignedPlanTx => buildPlanUnsignedSync(plan, plugins)

/**
 * The unsigned build against an explicitly supplied codec.
 *
 * @internal
 */
export const buildPlanUnsignedSync = (
  plan: UnsignedCardanoPlan,
  plugins: ReadonlyArray<Plugin> = DEFAULT_PLUGINS
): UnsignedPlanTx => {
  const { signerCount, ...rest } = plan
  // Placeholder keys: this path SIZES a tx it will not sign, so the signers only
  // need to exist in the right number (each contributes one witness slot).
  const sized: CardanoPlan = { ...rest, signers: Array.from({ length: signerCount }, () => "") }
  return buildPlanCore(sized, plugins)
}

/**
 * What {@link fitBySize} packed: the build, how many items it covers, and how
 * many were left for a later leg. `dropped` is reported rather than implied so a
 * caller can never silently truncate an item list.
 */
export interface FitBySizeResult {
  readonly built: UnsignedPlanTx
  readonly taken: number
  readonly dropped: number
}

/**
 * The size-fitting search against an explicitly supplied codec.
 *
 * @internal
 */
export const fitBySizeSync = (
  planFor: (take: number) => UnsignedCardanoPlan,
  itemCount: number,
  plugins: ReadonlyArray<Plugin> = DEFAULT_PLUGINS,
  minTake = 1
): FitBySizeResult => {
  if (itemCount <= 0) throw new Error("fitBySize: itemCount must be positive")
  if (minTake < 1) throw new Error("fitBySize: minTake must be at least 1")
  if (minTake > itemCount) throw new Error(`fitBySize: minTake ${minTake} exceeds itemCount ${itemCount}`)

  const attempt = (take: number): UnsignedPlanTx | null => {
    try {
      return buildPlanUnsignedSync(planFor(take), plugins)
    } catch (err) {
      // Only a size overflow means "try fewer". Anything else — insufficient
      // funds, bad params — is a real failure and must not be silently narrowed
      // into a smaller leg that happens to build.
      if (err instanceof TxTooLargeError) return null
      throw err
    }
  }

  // Not via `attempt`: if the smallest worthwhile prefix does not fit, the caller
  // needs the real TxTooLargeError with its real size and overBy, not a
  // fabricated one.
  let best = buildPlanUnsignedSync(planFor(minTake), plugins)

  // Exponential probe for an upper bound that does NOT fit, so the search range
  // is [lo, hi) with lo known-good and hi known-bad. The step doubles rather than
  // the bound, so the walk stays exponential from any `minTake`.
  let lo = minTake
  if (itemCount === minTake) return { built: best, taken: minTake, dropped: 0 }

  let step = 1
  let hi = lo + step
  for (;;) {
    if (hi > itemCount) {
      hi = itemCount
      const all = attempt(hi)
      if (all !== null) return { built: all, taken: hi, dropped: 0 }
      break
    }
    const probe = attempt(hi)
    if (probe === null) break
    lo = hi
    best = probe
    step *= 2
    hi = lo + step
  }

  // Binary search the boundary in (lo, hi).
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2)
    const probe = attempt(mid)
    if (probe === null) {
      hi = mid
    } else {
      lo = mid
      best = probe
    }
  }

  return { built: best, taken: lo, dropped: itemCount - lo }
}

/**
 * The largest prefix of `itemCount` items whose transaction fits under
 * `maxTxSize`, plus the build for it.
 *
 * Size is only knowable after assembly, so packing has to build to measure —
 * hence the exponential probe followed by a binary search rather than a linear
 * walk: each probe is a full build including coin selection.
 *
 * `planFor(take)` must produce a plan for the *first* `take` items. It is called
 * repeatedly, so it should be cheap and side-effect free.
 *
 * Nothing here decides whether splitting is *safe* — a CIP-25 mint and its
 * metadata must not be separated, a certificate's deposit accounting constrains
 * ordering, a swap must never split. Splittability is the caller's policy; this
 * only answers "how many fit".
 *
 * Legs must be packed one at a time in practice: a later leg's coin selection
 * depends on the earlier leg's change existing as a virtual UTxO, so a caller
 * cannot pack the whole sequence up front.
 *
 * `minTake` is the smallest prefix worth building, and it is not cosmetic. A
 * consolidation folding UTxOs into one output gains nothing from a single-item
 * leg, and worse, a lone asset-bearing UTxO cannot pay a fee on top of the
 * min-ADA its own assets already demand — so probing at 1 raises
 * `InsufficientError` for a prefix the caller never wanted, and that error is
 * (correctly) fatal here. Callers whose items are only meaningful in groups pass
 * their real floor.
 *
 * @since 0.1.0
 * @category building
 */
export const fitBySize = (
  planFor: (take: number) => UnsignedCardanoPlan,
  itemCount: number,
  plugins: ReadonlyArray<Plugin> = DEFAULT_PLUGINS,
  minTake = 1
): FitBySizeResult => fitBySizeSync(planFor, itemCount, plugins, minTake)

/** One asset and how much of it a packed output should carry. */
export interface AssetAmount {
  /** `policyIdHex.assetNameHex`. */
  readonly assetId: string
  readonly amount: bigint
}

/** What {@link packAssetsByValueSize} produced. */
export interface AssetPacking {
  /**
   * Assets grouped so each group's serialized value stays under `maxValueSize`,
   * in input order. Empty only when `assets` was empty.
   */
  readonly groups: ReadonlyArray<ReadonlyArray<AssetAmount>>
}

/**
 * The asset packing against an explicitly supplied codec.
 *
 * @internal
 */
export const packAssetsByValueSizeSync = (
  assets: ReadonlyArray<AssetAmount>,
  maxValueSize: bigint,
  coinPerGroup: bigint
): AssetPacking => {
  if (assets.length === 0) return { groups: [] }

  const sizeOf = (group: ReadonlyArray<AssetAmount>): number =>
    valueSize(Assets.merge(Assets.fromLovelace(coinPerGroup), pairsToAssets(group.map((a) => [a.assetId, a.amount] as const))))

  const groups: Array<Array<AssetAmount>> = []
  let current: Array<AssetAmount> = []

  for (const asset of assets) {
    const candidate = [...current, asset]
    if (BigInt(sizeOf(candidate)) <= maxValueSize) {
      current = candidate
      continue
    }
    // Does not fit alongside what we have. Close the group and start a new one.
    if (current.length > 0) {
      groups.push(current)
      current = [asset]
      if (BigInt(sizeOf(current)) <= maxValueSize) continue
    }
    // Alone and still over the bound: nothing smaller to move.
    throw new ValueTooLargeError(sizeOf([asset]), maxValueSize, groups.length)
  }
  if (current.length > 0) groups.push(current)
  return { groups }
}

/**
 * Split assets into groups small enough that each fits one output's value bound.
 *
 * Conway bounds the serialized `Value` of a single output (`maxValueSize`), which
 * is a different constraint from the transaction bound and has a different
 * remedy: assets that do not fit move to another **output**, not another
 * transaction. Folding many token UTxOs into one output — what consolidation
 * does — hits this bound first.
 *
 * Grouping is measured, not estimated: each candidate group is serialized with
 * `coinPerGroup` (the min-ADA a real output would carry) and measured, because a
 * `Value`'s CBOR size is not linear in asset count — assets share a policy map,
 * so two assets under one policy cost far less than two under two.
 *
 * Greedy and order-preserving: assets are taken in the order given, so a caller
 * that sorts by policy gets denser groups. A single asset that cannot fit on its
 * own is a hard failure — there is no smaller unit to move.
 *
 * @since 0.1.0
 * @category building
 */
export const packAssetsByValueSize = (
  assets: ReadonlyArray<AssetAmount>,
  maxValueSize: bigint,
  coinPerGroup: bigint
): AssetPacking => packAssetsByValueSizeSync(assets, maxValueSize, coinPerGroup)
