/**
 * CIP-1855 — forging policy keys for HD wallets.
 *
 * Path `m/1855'/1815'/policy_ix'` (all hardened), plus the CIP-5 prefixes `policy_vk`,
 * `policy_sk` and `policy_vkh`.
 *
 * ⚠️ **PROPOSED**, not ratified. The derivation is verified against CSL; the CIP-5 prefix
 * strings come from the spec text only.
 *
 * @since 0.1.0
 */

import { blake2b } from "@noble/hashes/blake2.js"

import { encode } from "./internal/Bech32.js"

const HARDENED = 0x80000000
const PURPOSE = 1855
const COIN_TYPE = 1815

/**
 * `m/1855'/1815'/policy_ix'`. `policyIx` is the un-hardened index; the hardened bit is applied
 * here.
 *
 * @since 0.1.0
 */
export const policyKeyPath = (policyIx: number): Uint32Array =>
  Uint32Array.of((PURPOSE | HARDENED) >>> 0, (COIN_TYPE | HARDENED) >>> 0, ((policyIx & ~HARDENED) | HARDENED) >>> 0)

/** CIP-5 `policy_vk…`. @since 0.1.0 */
export const policyVkBech32 = (pubkey: Uint8Array): string => encode("policy_vk", pubkey)
/** CIP-5 `policy_sk…`. @since 0.1.0 */
export const policySkBech32 = (privkey: Uint8Array): string => encode("policy_sk", privkey)
/** CIP-5 `policy_vkh…` — `blake2b_224(pubkey)`. @since 0.1.0 */
export const policyVkhBech32 = (pubkey: Uint8Array): string => encode("policy_vkh", blake2b(pubkey, { dkLen: 28 }))
