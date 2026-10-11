/**
 * CIP-27 — the royalty metadata standard.
 *
 * Label `777` carries `{rate, addr}`, read by marketplaces to pay a creator on a secondary sale.
 *
 * ⚠️ Metadata is hashed into `auxiliary_data_hash` and a hardware wallet re-serializes what it
 * is shown, so map key ORDER is part of the value. Two things guard it here, and measurement
 * says either would do alone: the keys are written in canonical order (`addr` < `rate`), **and**
 * the encoding uses `CANONICAL_OPTIONS`, which sorts. `CML_DEFAULT_OPTIONS` does **not** sort —
 * it preserves insertion order — so an extension to this map that writes keys out of order
 * would depend entirely on the options, and the options are the half that keeps working.
 *
 * @since 0.1.0
 */

import { CBOR, Metadata, TransactionMetadatum } from "@evolution-sdk/evolution"
import { Data, Effect } from "effect"

/** @since 0.1.0 */
export class Cip27Error extends Data.TaggedError("Cip27Error")<{ readonly reason: string }> {}

/** The CIP-27 royalty metadata label. @since 0.1.0 */
export const ROYALTY_LABEL = 777n

/** Metadatum text is capped at 64 **bytes**, not characters. */
const MAX_METADATUM_STRING = 64

/** @since 0.1.0 */
export interface Royalty {
  /** The `777` value — the `{rate, addr}` metadatum map, CBOR hex. */
  readonly metadatumHex: string
  /** The full metadata `{777: {rate, addr}}`, CBOR hex, ready for auxiliary data. */
  readonly metadataHex: string
}

const utf8Len = (s: string): number => new TextEncoder().encode(s).length

/**
 * Split into chunks of at most 64 UTF-8 bytes, which is the CIP-27 `addr` array form.
 *
 * ⚠️ Iterated by code point, not by UTF-16 unit, so a surrogate pair is never split in half.
 */
const chunkString = (s: string): Array<string> => {
  if (utf8Len(s) <= MAX_METADATUM_STRING) return [s]
  const out: Array<string> = []
  let cur = ""
  for (const ch of s) {
    if (utf8Len(cur + ch) > MAX_METADATUM_STRING) {
      out.push(cur)
      cur = ch
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

const addrMetadatum = (addr: string | ReadonlyArray<string>): TransactionMetadatum.TransactionMetadatum => {
  const parts = Array.isArray(addr) ? [...addr] : chunkString(addr as string)
  for (const p of parts) {
    if (utf8Len(p) > MAX_METADATUM_STRING) {
      throw new Error(`addr chunk exceeds ${MAX_METADATUM_STRING} bytes: "${p}"`)
    }
  }
  return parts.length === 1 ? parts[0]! : parts
}

/**
 * Build the CIP-27 royalty metadata.
 *
 * `rate` is a decimal string in [0, 1] — `"0.125"` is 12.5%. `addr` is a bech32 payment address,
 * chunked automatically when it exceeds the metadatum limit, or an already-chunked array.
 *
 * @since 0.1.0
 */
export const royalty = (rate: string, addr: string | ReadonlyArray<string>): Effect.Effect<Royalty, Cip27Error> =>
  Effect.try({
    try: (): Royalty => {
      const r = Number(rate)
      if (!/^\d*\.?\d+$/.test(rate) || Number.isNaN(r) || r < 0 || r > 1) {
        throw new Error(`royalty rate "${rate}" must be a decimal string in [0, 1]`)
      }
      const map: TransactionMetadatum.TransactionMetadatum = new globalThis.Map<
        TransactionMetadatum.TransactionMetadatum,
        TransactionMetadatum.TransactionMetadatum
      >([
        ["addr", addrMetadatum(addr)],
        ["rate", rate]
      ])
      return {
        metadatumHex: TransactionMetadatum.toCBORHex(map, CBOR.CANONICAL_OPTIONS),
        metadataHex: Metadata.toCBORHex(CBOR.CANONICAL_OPTIONS)(Metadata.fromEntries([[ROYALTY_LABEL, map]]))
      }
    },
    catch: (e) => new Cip27Error({ reason: e instanceof Error ? e.message : String(e) })
  })
