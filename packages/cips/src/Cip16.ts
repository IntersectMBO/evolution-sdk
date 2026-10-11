/**
 * CIP-16 — cryptographic key serialisation.
 *
 * The byte layouts and their CIP-5 bech32 prefixes:
 *
 * ```
 * vk  = raw 32
 * sk  = raw 32
 * xvk = pubkey(32) ‖ chaincode(32)   = 64
 * xsk = extended(64) ‖ chaincode(32) = 96
 * ```
 *
 * The 96-byte `xsk` is the BIP-32 xprv layout, and `xvk = bip32_public(xprv) ‖ xprv[64..96]`.
 *
 * ⚠️ Every encoder checks its length. A key of the wrong size encodes to a perfectly valid
 * bech32 string of the wrong kind, which is the sort of value that travels a long way before
 * anything notices.
 *
 * @since 0.1.0
 */

import { decode as bech32Decode, encode as bech32Encode, prefixOf } from "./internal/Bech32.js"

/** @since 0.1.0 */
export const VK_LEN = 32
/** @since 0.1.0 */
export const SK_LEN = 32
/** @since 0.1.0 */
export const XVK_LEN = 64
/** @since 0.1.0 */
export const XSK_LEN = 96

/** Common CIP-5 key prefixes; any CIP-5 `*_vk`/`*_xvk`/`*_sk`/`*_xsk` may be used. @since 0.1.0 */
export const ADDR_VK = "addr_vk"
/** @since 0.1.0 */
export const ADDR_XVK = "addr_xvk"
/** @since 0.1.0 */
export const ADDR_XSK = "addr_xsk"
/** @since 0.1.0 */
export const STAKE_VK = "stake_vk"
/** @since 0.1.0 */
export const STAKE_XVK = "stake_xvk"
/** @since 0.1.0 */
export const ACCT_XVK = "acct_xvk"
/** @since 0.1.0 */
export const ACCT_XSK = "acct_xsk"
/** @since 0.1.0 */
export const ROOT_XVK = "root_xvk"
/** @since 0.1.0 */
export const ROOT_XSK = "root_xsk"

const enc = (prefix: string, data: Uint8Array, want: number): string => {
  if (data.length !== want) throw new Error(`cip16: expected ${want} bytes, got ${data.length}`)
  return bech32Encode(prefix, data)
}

/** A raw 32-byte public key under a CIP-5 `*_vk` prefix. @since 0.1.0 */
export const vkBech32 = (prefix: string, pubkey: Uint8Array): string => enc(prefix, pubkey, VK_LEN)
/** A raw 32-byte private key under a CIP-5 `*_sk` prefix. @since 0.1.0 */
export const skBech32 = (prefix: string, privkey: Uint8Array): string => enc(prefix, privkey, SK_LEN)
/** A 64-byte extended public key under a CIP-5 `*_xvk` prefix. @since 0.1.0 */
export const xvkBech32 = (prefix: string, xvk: Uint8Array): string => enc(prefix, xvk, XVK_LEN)
/** A 96-byte extended private key under a CIP-5 `*_xsk` prefix. @since 0.1.0 */
export const xskBech32 = (prefix: string, xsk: Uint8Array): string => enc(prefix, xsk, XSK_LEN)

/**
 * Assemble the 64-byte xvk from a 32-byte public key and a 32-byte chain code.
 *
 * @since 0.1.0
 */
export const xvkFromParts = (pubkey: Uint8Array, chaincode: Uint8Array): Uint8Array => {
  if (pubkey.length !== 32 || chaincode.length !== 32) throw new Error("cip16: xvk parts must be 32 bytes each")
  const v = new Uint8Array(64)
  v.set(pubkey, 0)
  v.set(chaincode, 32)
  return v
}

/**
 * The 64-byte xvk for a 96-byte xsk and its derived public key — the chain code is spliced out
 * of `xsk[64..96]`.
 *
 * @since 0.1.0
 */
export const xvkFromXsk = (xsk: Uint8Array, pubkey: Uint8Array): Uint8Array => {
  if (xsk.length !== XSK_LEN) throw new Error("cip16: xsk must be 96 bytes")
  return xvkFromParts(pubkey, xsk.subarray(64, 96))
}

/**
 * Decode any CIP-16 key bech32. The caller checks the expected length and shape.
 *
 * @since 0.1.0
 */
export const decode = (s: string): { readonly prefix: string; readonly bytes: Uint8Array } => {
  const prefix = prefixOf(s)
  if (prefix === undefined) throw new Error(`cip16: "${s.slice(0, 24)}" is not bech32`)
  return { prefix, bytes: bech32Decode(prefix, s) }
}
