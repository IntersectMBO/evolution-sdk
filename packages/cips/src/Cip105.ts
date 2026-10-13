/**
 * CIP-105 — Conway-era key chains.
 *
 * CIP-1852 roles 3 / 4 / 5 for DRep, CC-cold and CC-hot keys, plus the CIP-5 prefixes
 * `{drep,cc_cold,cc_hot}_{sk,vk,vkh}`. The `_vkh` value is `blake2b_224(pubkey)` — the
 * credential — which {@link Cip129} then wraps into a header-byte identifier.
 *
 * Derivation itself is a BIP-32 concern; this module is the paths and the encodings.
 *
 * @since 0.1.0
 */

import { blake2b } from "@noble/hashes/blake2.js"

import { encode } from "./internal/Bech32.js"

const HARDENED = 0x80000000
const PURPOSE = 1852
const COIN_TYPE = 1815

/** @since 0.1.0 */
export const ROLE_DREP = 3
/** @since 0.1.0 */
export const ROLE_CC_COLD = 4
/** @since 0.1.0 */
export const ROLE_CC_HOT = 5

const keyPath = (role: number, account: number, index: number): Uint32Array =>
  Uint32Array.of(
    (PURPOSE | HARDENED) >>> 0,
    (COIN_TYPE | HARDENED) >>> 0,
    ((account & ~HARDENED) | HARDENED) >>> 0,
    role,
    index
  )

/** `m/1852'/1815'/account'/3/index` — a DRep key. @since 0.1.0 */
export const drepKeyPath = (account: number, index: number): Uint32Array => keyPath(ROLE_DREP, account, index)
/** `m/1852'/1815'/account'/4/index` — a CC-cold key. @since 0.1.0 */
export const ccColdKeyPath = (account: number, index: number): Uint32Array => keyPath(ROLE_CC_COLD, account, index)
/** `m/1852'/1815'/account'/5/index` — a CC-hot key. @since 0.1.0 */
export const ccHotKeyPath = (account: number, index: number): Uint32Array => keyPath(ROLE_CC_HOT, account, index)

const vkh = (pubkey: Uint8Array): Uint8Array => blake2b(pubkey, { dkLen: 28 })

/** @since 0.1.0 */
export const drepVkBech32 = (pubkey: Uint8Array): string => encode("drep_vk", pubkey)
/** @since 0.1.0 */
export const drepSkBech32 = (privkey: Uint8Array): string => encode("drep_sk", privkey)
/** @since 0.1.0 */
export const drepVkhBech32 = (pubkey: Uint8Array): string => encode("drep_vkh", vkh(pubkey))

/** @since 0.1.0 */
export const ccColdVkBech32 = (pubkey: Uint8Array): string => encode("cc_cold_vk", pubkey)
/** @since 0.1.0 */
export const ccColdSkBech32 = (privkey: Uint8Array): string => encode("cc_cold_sk", privkey)
/** @since 0.1.0 */
export const ccColdVkhBech32 = (pubkey: Uint8Array): string => encode("cc_cold_vkh", vkh(pubkey))

/** @since 0.1.0 */
export const ccHotVkBech32 = (pubkey: Uint8Array): string => encode("cc_hot_vk", pubkey)
/** @since 0.1.0 */
export const ccHotSkBech32 = (privkey: Uint8Array): string => encode("cc_hot_sk", privkey)
/** @since 0.1.0 */
export const ccHotVkhBech32 = (pubkey: Uint8Array): string => encode("cc_hot_vkh", vkh(pubkey))
