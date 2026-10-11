/**
 * CIP-129 — governance identifiers.
 *
 * The header-byte + bech32 encoding for the Conway governance credentials and governance-action
 * ids — the identifier companion to the CIP-1694 transaction surface.
 *
 * ```
 * credential id = bech32(hrp, header_byte ‖ hash28)
 *   key  type (header bits 7-4): cc_hot 0x0 · cc_cold 0x1 · drep 0x2
 *   cred type (header bits 3-0): key-hash 0x2 · script-hash 0x3
 * gov_action id = bech32("gov_action", txid32 ‖ minimal-BE(index))   (index 0 → 00)
 * ```
 *
 * @since 0.1.0
 */

import { decode, encode, prefixOf } from "./internal/Bech32.js"

/** @since 0.1.0 */
export type GovKeyType = "cc_hot" | "cc_cold" | "drep"

const KEY_NIBBLE: Record<GovKeyType, number> = { cc_hot: 0x0, cc_cold: 0x1, drep: 0x2 }
const CT_KEY = 0x2
const CT_SCRIPT = 0x3

const keyTypeFromNibble = (n: number): GovKeyType | undefined =>
  n === 0x0 ? "cc_hot" : n === 0x1 ? "cc_cold" : n === 0x2 ? "drep" : undefined

/** A decoded CIP-129 governance credential. @since 0.1.0 */
export interface GovCredential {
  readonly keyType: GovKeyType
  readonly isScript: boolean
  readonly hash: Uint8Array
}

/**
 * Encode a governance credential to its bech32 id.
 *
 * @since 0.1.0
 */
export const credentialBech32 = (keyType: GovKeyType, isScript: boolean, hash: Uint8Array): string => {
  const data = new Uint8Array(1 + hash.length)
  data[0] = (KEY_NIBBLE[keyType] << 4) | (isScript ? CT_SCRIPT : CT_KEY)
  data.set(hash, 1)
  return encode(keyType, data)
}

/** `drep…`. @since 0.1.0 */
export const drepBech32 = (hash: Uint8Array, isScript: boolean): string => credentialBech32("drep", isScript, hash)
/** `cc_hot…`. @since 0.1.0 */
export const ccHotBech32 = (hash: Uint8Array, isScript: boolean): string => credentialBech32("cc_hot", isScript, hash)
/** `cc_cold…`. @since 0.1.0 */
export const ccColdBech32 = (hash: Uint8Array, isScript: boolean): string => credentialBech32("cc_cold", isScript, hash)

/**
 * Decode any CIP-129 credential id.
 *
 * ⚠️ `undefined` — never a partial answer — on a bad checksum, an unknown key or credential
 * type, the wrong payload length, or an **hrp that disagrees with the header byte**. That last
 * one is the case worth naming: the prefix and the header both state the key type, and a value
 * where they disagree is not a credential of either kind.
 *
 * @since 0.1.0
 */
export const parseCredential = (s: string): GovCredential | undefined => {
  const hrp = prefixOf(s)
  if (hrp === undefined) return undefined
  let bytes: Uint8Array
  try {
    bytes = decode(hrp, s)
  } catch {
    return undefined
  }
  if (bytes.length !== 29) return undefined // 1-byte header + 28-byte hash
  const header = bytes[0]!
  const keyType = keyTypeFromNibble(header >> 4)
  if (keyType === undefined || keyType !== hrp) return undefined
  const ct = header & 0x0f
  if (ct !== CT_KEY && ct !== CT_SCRIPT) return undefined
  return { keyType, isScript: ct === CT_SCRIPT, hash: bytes.slice(1) }
}

/** Minimal big-endian bytes of `index`, with a one-byte minimum. */
const indexBytes = (index: number): Uint8Array => {
  if (index === 0) return Uint8Array.from([0])
  const be: Array<number> = []
  let i = index
  while (i > 0) {
    be.unshift(i & 0xff)
    i = Math.floor(i / 256)
  }
  return Uint8Array.from(be)
}

/**
 * `gov_action…` id.
 *
 * @since 0.1.0
 */
export const govActionBech32 = (txid: Uint8Array, index: number): string => {
  const idx = indexBytes(index)
  const data = new Uint8Array(txid.length + idx.length)
  data.set(txid, 0)
  data.set(idx, txid.length)
  return encode("gov_action", data)
}

/**
 * Decode a `gov_action…` id into its transaction id and index.
 *
 * @since 0.1.0
 */
export const parseGovAction = (s: string): readonly [Uint8Array, number] | undefined => {
  let bytes: Uint8Array
  try {
    bytes = decode("gov_action", s)
  } catch {
    return undefined
  }
  if (bytes.length < 33) return undefined
  let index = 0
  for (const b of bytes.subarray(32)) index = index * 256 + b
  return [bytes.slice(0, 32), index]
}
