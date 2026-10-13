/**
 * Bech32, with the prefix checked in both directions.
 *
 * ⚠️ `Bech32.FromBytes(prefix)` uses its `prefix` argument only when **encoding**: decoding
 * accepts any prefix and hands back the payload, so a `drep1…` string decodes cleanly under
 * `FromBytes("asset")`. Every identifier in this package is prefix-typed — a `cc_cold` id read
 * as a `drep` is a credential of the wrong kind — so decoding here verifies the prefix and
 * refuses a mismatch.
 *
 * @since 0.1.0
 */

import { Bech32 as EvoBech32 } from "@evolution-sdk/evolution"
import { Schema } from "effect"

/** @since 0.1.0 */
export const encode = (prefix: string, bytes: Uint8Array): string =>
  Schema.decodeSync(EvoBech32.FromBytes(prefix))(bytes)

/**
 * Decode, requiring `prefix`.
 *
 * @since 0.1.0
 */
export const decode = (prefix: string, s: string): Uint8Array => {
  // A bech32 string is `<hrp>1<data>`, and the separator is the LAST "1", because an hrp is
  // allowed to contain one.
  const sep = s.lastIndexOf("1")
  if (sep <= 0) throw new Error(`bech32: "${s.slice(0, 24)}" has no separator`)
  const hrp = s.slice(0, sep)
  if (hrp !== prefix) throw new Error(`bech32: expected prefix "${prefix}", got "${hrp}"`)
  return Schema.encodeSync(EvoBech32.FromBytes(prefix))(s)
}

/**
 * The prefix of a bech32 string, without decoding its payload.
 *
 * @since 0.1.0
 */
export const prefixOf = (s: string): string | undefined => {
  const sep = s.lastIndexOf("1")
  return sep <= 0 ? undefined : s.slice(0, sep)
}
