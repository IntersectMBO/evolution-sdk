/**
 * CIP-4 — the wallet checksum.
 *
 * A short, human-comparable fingerprint of an account public key, so a user can tell two wallets
 * apart without reading a key. Deliberately NOT a security boundary: it is a typo check, and a
 * short one.
 *
 * @since 0.1.0
 */

import { blake2b } from "@noble/hashes/blake2.js"

export interface WalletChecksum {
  /** The user-facing TextPart, format `XXXX-1234`. */
  readonly plate: string
  /** 128-hex-char blake2b-512 digest — the ImagePart seed for avatar rendering (UI). */
  readonly seed: string
}

const PERSONALIZATION = new TextEncoder().encode("wallets checksum") // exactly 16 bytes
const ALPHA = "ABCDEJHKLNOPSTXZ" // 16 easy-to-distinguish letters
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")

/** FNV-1a-32 over a string's char codes (matches `@emurgo/cip4-js` `fast1a32`). */
function fnv1a32(s: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/**
 * The CIP-4 wallet checksum of an account public key given as a lowercase hex
 * string (a leading `0x` is stripped). For HD wallets the key SHOULD include the
 * chain code (i.e. a 64-byte xpub → 128 hex chars).
 */
export function walletChecksum(publicKeyHex: string): WalletChecksum {
  const clean = publicKeyHex.startsWith("0x") ? publicKeyHex.slice(2) : publicKeyHex

  // Hash the hex STRING as UTF-8 bytes (not the decoded key) — per CIP-4 / @emurgo/cip4-js.
  const seed = toHex(blake2b(new TextEncoder().encode(clean), { dkLen: 64, personalization: PERSONALIZATION }))

  const fnv = fnv1a32(seed)
  const a = fnv & 0xff
  const b = (fnv >>> 8) & 0xff
  const c = (fnv >>> 16) & 0xff
  const d = (fnv >>> 24) & 0xff
  const letters = (x: number) => `${ALPHA[Math.floor(x / 16)]}${ALPHA[x % 16]}`
  const numbers = `${((c << 8) + d) % 10000}`.padStart(4, "0")

  return { plate: `${letters(a)}${letters(b)}-${numbers}`, seed }
}
