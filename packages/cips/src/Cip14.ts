/**
 * CIP-14 — the user-facing asset fingerprint.
 *
 * `asset1…` = `bech32("asset", blake2b_160(policy_id ‖ asset_name))`. A short, checksummed,
 * copy-pasteable name for an asset, distinct from the policy id and the asset name it is
 * derived from.
 *
 * @since 0.1.0
 */

import { blake2b } from "@noble/hashes/blake2.js"

import { encode } from "./internal/Bech32.js"

/**
 * The CIP-14 asset fingerprint for a policy id and asset name, both raw bytes.
 *
 * @since 0.1.0
 */
export const assetFingerprint = (policyId: Uint8Array, assetName: Uint8Array): string => {
  const msg = new Uint8Array(policyId.length + assetName.length)
  msg.set(policyId, 0)
  msg.set(assetName, policyId.length)
  return encode("asset", blake2b(msg, { dkLen: 20 }))
}
