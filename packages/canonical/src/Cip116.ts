/**
 * CIP-116 — the canonical JSON encoding for Cardano domain types.
 *
 * **Scope**: the subset a CIP-139 query layer actually returns —
 * `TransactionUnspentOutput` and everything inside it (`Value`, `PlutusData`, `PlutusScript`).
 * The recursive `Transaction` / `Block` / `NativeScript` / `TransactionMetadatum` encodings are
 * deliberately absent: their right source is the transaction CBOR and a decoder, not an
 * indexer's flattened JSON.
 *
 * ⚠️ The scalar conventions are the easiest thing in CIP-116 to get wrong, so they are stated
 * once here rather than rediscovered per call site:
 *
 * - `TransactionInput.index` is `UInt32` — a JSON **number**.
 * - `coin` (`UInt64`), asset amounts (`PosInt64`) and `PlutusDataConstr.alternative` (`UInt64`)
 *   are **decimal strings**. A number there is a schema violation, and for amounts it would also
 *   silently truncate past 2^53.
 * - Addresses are bech32 strings (Byron: base58), never raw hex.
 * - `PlutusDataInteger.value` is `BigInt` — an unbounded decimal string, which is what lets a
 *   datum's integers survive this encoding intact.
 *
 * ⚠️ `PosInt64` is zero-**exclusive**, so a zero-quantity asset entry cannot be represented and
 * is dropped rather than emitted as `"0"`.
 *
 * @since 0.1.0
 */

import type { Phase1, Types } from "@evolution-sdk/review"

const HEX = "0123456789abcdef"
const bytesToHex = (b: Uint8Array): string => {
  let out = ""
  for (const x of b) out += HEX[x >> 4]! + HEX[x & 0x0f]!
  return out
}

/** CIP-116 `Language` — the Plutus language tag, as spelled by the JSON schema. */
export type Cip116Language = "plutus_v1" | "plutus_v2" | "plutus_v3"

const LANGUAGE: Record<"V1" | "V2" | "V3", Cip116Language> = {
  V1: "plutus_v1",
  V2: "plutus_v2",
  V3: "plutus_v3"
}

export type Cip116PlutusData =
  | { readonly tag: "constr"; readonly alternative: string; readonly data: ReadonlyArray<Cip116PlutusData> }
  | {
      readonly tag: "map"
      readonly contents: ReadonlyArray<{ readonly key: Cip116PlutusData; readonly value: Cip116PlutusData }>
    }
  | { readonly tag: "list"; readonly contents: ReadonlyArray<Cip116PlutusData> }
  | { readonly tag: "integer"; readonly value: string }
  | { readonly tag: "bytes"; readonly value: string }

export interface Cip116PlutusScript {
  readonly language: Cip116Language
  readonly bytes: string
}

/** `MultiAsset` — policy hex → asset-name hex → amount (decimal string). */
/** Policy id → (asset name → quantity). Both levels are `| undefined`: the keys are
 *  whatever the holder happens to own, so indexing one you don't hold is the normal case,
 *  and the published `.d.ts` must say so regardless of the consumer's
 *  `noUncheckedIndexedAccess` setting. */
export type Cip116MultiAsset = Readonly<Record<string, Readonly<Record<string, string | undefined>> | undefined>>

export interface Cip116Value {
  readonly coin: string
  readonly assets?: Cip116MultiAsset
}

export interface Cip116TransactionInput {
  readonly transaction_id: string
  readonly index: number
}

/** `plutus_data` — an inline datum or the hash of one. */
export type Cip116DatumOption =
  { readonly tag: "datum"; readonly value: Cip116PlutusData } | { readonly tag: "datum_hash"; readonly value: string }

/** `script_ref` — only the Plutus arm; see the module scope note on `NativeScript`. */
export type Cip116ScriptRef = { readonly tag: "plutus_script"; readonly value: Cip116PlutusScript }

export interface Cip116TransactionOutput {
  readonly address: string
  readonly amount: Cip116Value
  readonly plutus_data?: Cip116DatumOption
  readonly script_ref?: Cip116ScriptRef
  /**
   * The inline datum's original CBOR, hex — **an extension, not CIP-116**.
   *
   * `plutus_data` is information-complete but not byte-exact: the JSON tree does not
   * capture CBOR encoding choices (definite vs indefinite length, chunked byte
   * strings, bignum tags, tag 102 for large constructor alternatives), so
   * re-serializing it is not guaranteed to reproduce the datum's bytes. Any consumer
   * that must hash or re-submit the datum needs the original, and every consumer that
   * merely wants to read fields is spared a JSON→CBOR round trip.
   *
   * This is schema-legal: `TransactionOutput` is the one type in this file that does
   * NOT set `unevaluatedProperties: false` (unlike `TransactionUnspentOutput` and
   * every `PlutusData` variant), so an extra property here still validates.
   */
  readonly datum_hex?: string
}

export interface Cip116TransactionUnspentOutput {
  readonly input: Cip116TransactionInput
  readonly output: Cip116TransactionOutput
}

/** Big-endian bytes → magnitude. */
const beToBigint = (be: Uint8Array): bigint => {
  let n = 0n
  for (const b of be) n = (n << 8n) | BigInt(b)
  return n
}

/**
 * The pure-ts core keeps CBOR bignums (tag 2 / 3) as a sign plus big-endian
 * magnitude, because that is what round-trips the bytes. CIP-116 has one integer
 * form, so both collapse into it — tag 3's value is `-1 - magnitude`, not
 * `-magnitude`.
 */
const bignumValue = (negative: boolean, be: Uint8Array): bigint => {
  const mag = beToBigint(be)
  return negative ? -1n - mag : mag
}

/** Our `PlutusData` IR → CIP-116 JSON. Total over the IR; no lossy cases. */
export const plutusData = (pd: Types.PlutusData): Cip116PlutusData => {
  switch (pd.type) {
    case "constr":
      return { tag: "constr", alternative: pd.alt.toString(), data: pd.fields.map(plutusData) }
    case "map":
      return { tag: "map", contents: pd.pairs.map(([k, v]) => ({ key: plutusData(k), value: plutusData(v) })) }
    case "list":
      return { tag: "list", contents: pd.items.map(plutusData) }
    case "int":
      return { tag: "integer", value: pd.value.toString() }
    case "bigint":
      return { tag: "integer", value: bignumValue(pd.negative, pd.be).toString() }
    case "bytes":
      return { tag: "bytes", value: bytesToHex(pd.bytes) }
  }
}

/** A reference script's Plutus version + bytes → CIP-116 `PlutusScript`. */
export const plutusScript = (version: "V1" | "V2" | "V3", bytesHex: string): Cip116PlutusScript => ({
  language: LANGUAGE[version],
  bytes: bytesHex
})

/**
 * Coin + our structural asset list → CIP-116 `Value`.
 *
 * Same-asset rows are summed rather than overwriting each other: an indexer can
 * legitimately return one row per UTxO entry, and a plain object assignment would
 * silently keep only the last. Zero quantities are dropped (`PosInt64` excludes 0).
 */
export const value = (coin: bigint, assets: ReadonlyArray<Phase1.AssetAmount>): Cip116Value => {
  const multi: Record<string, Record<string, string>> = {}
  for (const a of assets) {
    if (a.quantity === 0n) continue
    const byName = (multi[a.policyHex] ??= {})
    const prev = byName[a.nameHex]
    byName[a.nameHex] = (prev === undefined ? a.quantity : BigInt(prev) + a.quantity).toString()
  }
  const policies = Object.keys(multi)
  return policies.length === 0 ? { coin: coin.toString() } : { coin: coin.toString(), assets: multi }
}

export const transactionInput = (txHash: string, index: number): Cip116TransactionInput => ({
  transaction_id: txHash,
  index
})

export const transactionUnspentOutput = (
  input: Cip116TransactionInput,
  output: Cip116TransactionOutput
): Cip116TransactionUnspentOutput => ({ input, output })
