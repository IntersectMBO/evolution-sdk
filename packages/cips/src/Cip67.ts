/**
 * CIP-67 — the asset-name label registry, in bytes.
 *
 * A 4-byte `asset_name` prefix classifying the asset:
 * `[ 0000 | 16-bit label_num | 8-bit CRC-8(poly 0x07) | 0000 ]`.
 *
 * ⚠️ The label arithmetic itself is `@evolution-sdk/evolution`'s `Label`, not a second copy —
 * the two were compared over **all 65,536 labels in both directions** and agree exactly. What is
 * here is the byte-oriented surface CIP-68 and CIP-102 need: `Label` speaks hex strings, and an
 * `asset_name` is bytes.
 *
 * @since 0.1.0
 */

import { Label } from "@evolution-sdk/evolution"

const HEX = "0123456789abcdef"
const toHex = (b: Uint8Array): string => {
  let s = ""
  for (const x of b) s += HEX[x >> 4]! + HEX[x & 0x0f]!
  return s
}

/**
 * The 4-byte CIP-67 label prefix for `labelNum` (0..65535).
 *
 * @since 0.1.0
 */
export const toLabel = (labelNum: number): Uint8Array => {
  const hex = Label.toLabel(labelNum)
  const out = new Uint8Array(4)
  for (let i = 0; i < 4; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Prefix `content` with the CIP-67 label for `labelNum`, giving a full `asset_name`.
 *
 * @since 0.1.0
 */
export const toAssetName = (labelNum: number, content: Uint8Array): Uint8Array => {
  const label = toLabel(labelNum)
  const out = new Uint8Array(label.length + content.length)
  out.set(label, 0)
  out.set(content, label.length)
  return out
}

/**
 * Read the CIP-67 label off the first 4 bytes of an `asset_name`.
 *
 * `undefined` when the name is shorter than 4 bytes, the bracket nibbles are non-zero, or the
 * CRC-8 does not match — an asset name is untrusted input, and "this is not a labelled name" is
 * the common case rather than an error.
 *
 * @since 0.1.0
 */
export const fromLabel = (assetName: Uint8Array): number | undefined =>
  assetName.length < 4 ? undefined : Label.fromLabel(toHex(assetName.subarray(0, 4)))

/** The CIP-67 / CIP-68 reserved label numbers. @since 0.1.0 */
export const LABEL_REFERENCE_NFT = 100
/** @since 0.1.0 */
export const LABEL_USER_NFT = 222
/** @since 0.1.0 */
export const LABEL_USER_FT = 333
/** @since 0.1.0 */
export const LABEL_USER_RFT = 444
/** @since 0.1.0 */
export const LABEL_ROYALTY = 777
