/**
 * Hex conversion, local to this package.
 *
 * Kept here rather than taken from a dependency so the package adds none beyond
 * `@evolution-sdk/evolution`, `@evolution-sdk/review` and `effect`.
 *
 * @since 0.1.0
 */

const HEX = "0123456789abcdef"

/** @since 0.1.0 */
export const bytesToHex = (bytes: Uint8Array): string => {
  let out = ""
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 0x0f]!
  return out
}

/**
 * ⚠️ Throws on anything that is not an even-length run of hex digits. A decoder handed a
 * truncated or mistyped string must fail, not decode a prefix.
 *
 * @since 0.1.0
 */
export const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error(`not hex: ${hex.slice(0, 32)}`)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
