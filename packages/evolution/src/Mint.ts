import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as AssetName from "./AssetName.js"
import * as Bytes from "./Bytes.js"
import * as _Codec from "./Codec.js"
import * as NonZeroInt64 from "./NonZeroInt64.js"
import * as PolicyId from "./PolicyId.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Helper function for content-based Map equality using Equal.equals.
 * Compares two Maps by iterating entries and using Equal.equals for both keys and values.
 *
 * @since 2.0.0
 * @category equality
 */
const mapEquals = <K, V>(a: Map<K, V>, b: Map<K, V>): boolean => {
  if (a.size !== b.size) return false

  for (const [aKey, aValue] of a.entries()) {
    let found = false
    for (const [bKey, bValue] of b.entries()) {
      if (Equal.equals(aKey, bKey)) {
        if (aValue instanceof Map && bValue instanceof Map) {
          if (!mapEquals(aValue, bValue)) return false
        } else {
          if (!Equal.equals(aValue, bValue)) return false
        }
        found = true
        break
      }
    }
    if (!found) return false
  }

  return true
}

/**
 * Helper function for content-based Map hashing.
 * Computes hash by XORing hashes of all entries for order-independence.
 *
 * @since 2.0.0
 * @category hashing
 */
const mapHash = <K, V>(map: Map<K, V>): number => {
  let hash = Hash.hash(map.size)
  for (const [key, value] of map.entries()) {
    hash ^= Hash.hash(key) ^ Hash.hash(value)
  }
  return hash
}

/**
 * Schema for inner asset map
 * ```
 * (asset_name => nonZeroInt64).
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export const AssetMap = Schema.Map({
  key: AssetName.AssetName,
  value: NonZeroInt64.NonZeroInt64
}).annotations({
  identifier: "Mint.AssetMap"
})

export type AssetMap = typeof AssetMap.Type

/**
 * Schema for Mint representing token minting/burning operations.
 * ```
 * mint = multiasset<nonZeroInt64>
 *
 * The structure is: policy_id => { asset_name => nonZeroInt64 }
 * - Positive values represent minting
 * - Negative values represent burning
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class Mint extends Schema.Class<Mint>("Mint")({
  map: Schema.Map({
    key: PolicyId.PolicyId,
    value: AssetMap
  })
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    const serializedMap: Record<string, Record<string, string>> = {}
    for (const [policyId, assetMap] of this.map.entries()) {
      const serializedAssets: Record<string, string> = {}
      for (const [assetName, quantity] of assetMap.entries()) {
        serializedAssets[assetName.toString()] = quantity.toString()
      }
      serializedMap[policyId.toString()] = serializedAssets
    }
    return {
      _tag: "Mint",
      map: serializedMap
    }
  }

  /**
   * Convert to string representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * Custom inspect for Node.js REPL.
   *
   * @since 2.0.0
   * @category conversions
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * Structural equality check.
   *
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return that instanceof Mint && mapEquals(this.map, that.map)
  }

  /**
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    let hash = Hash.hash(this.map.size)
    for (const [policyId, assetMap] of this.map.entries()) {
      const policyHash = Hash.hash(policyId)
      const assetMapHash = mapHash(assetMap)
      hash ^= policyHash ^ assetMapHash
    }
    return Hash.cached(this, hash)
  }
}

/**
 * Check if a value is a valid Mint.
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = Schema.is(Mint)

/**
 * Create empty Mint.
 *
 * @since 2.0.0
 * @category constructors
 */
export const empty = (): Mint => new Mint({ map: new Map<PolicyId.PolicyId, AssetMap>() })

/**
 * Create Mint from a single policy and asset entry.
 *
 * @since 2.0.0
 * @category constructors
 */
export const singleton = (
  policyId: PolicyId.PolicyId,
  assetName: AssetName.AssetName,
  amount: NonZeroInt64.NonZeroInt64
): Mint => {
  const assetMap = new Map([[assetName, amount]])
  return new Mint({ map: new Map([[policyId, assetMap]]) })
}

/**
 * Create Mint from entries array.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromEntries = (
  entries: Array<[PolicyId.PolicyId, Array<[AssetName.AssetName, NonZeroInt64.NonZeroInt64]>]>
): Mint => {
  const innerMap = new Map(entries.map(([policyId, assetEntries]) => [policyId, new Map(assetEntries)]))
  return new Mint({ map: innerMap })
}

/**
 * Add or update an asset in the Mint.
 * Uses content-based equality (Equal.equals) to find matching PolicyId and AssetName
 * since JavaScript Maps use reference equality by default.
 *
 * @since 2.0.0
 * @category transformation
 */
export const insert = (
  mint: Mint,
  policyId: PolicyId.PolicyId,
  assetName: AssetName.AssetName,
  amount: NonZeroInt64.NonZeroInt64
): Mint => {
  // Find existing policy by content equality
  let existingPolicyKey: PolicyId.PolicyId | undefined
  let existingAssetMap: Map<AssetName.AssetName, NonZeroInt64.NonZeroInt64> | undefined

  for (const [key, value] of mint.map.entries()) {
    if (Equal.equals(key, policyId)) {
      existingPolicyKey = key
      existingAssetMap = value
      break
    }
  }

  // Build the new asset map for this policy
  let assetMap: Map<AssetName.AssetName, NonZeroInt64.NonZeroInt64>

  if (existingAssetMap !== undefined) {
    // Find existing asset by content equality
    let existingAssetKey: AssetName.AssetName | undefined
    for (const key of existingAssetMap.keys()) {
      if (Equal.equals(key, assetName)) {
        existingAssetKey = key
        break
      }
    }

    assetMap = new Map(existingAssetMap)
    // Remove old key if exists (to ensure we use the new key reference)
    if (existingAssetKey !== undefined) {
      assetMap.delete(existingAssetKey)
    }
    assetMap.set(assetName, amount)
  } else {
    assetMap = new Map([[assetName, amount]])
  }

  // Build result map, replacing existing policy entry if found
  const result = new Map(mint.map)
  if (existingPolicyKey !== undefined) {
    result.delete(existingPolicyKey)
  }
  result.set(policyId, assetMap)
  return new Mint({ map: result })
}

/**
 * Remove a policy from the Mint.
 * Uses content-based equality (Equal.equals) to find matching PolicyId.
 *
 * @since 2.0.0
 * @category transformation
 */
export const removePolicy = (mint: Mint, policyId: PolicyId.PolicyId): Mint => {
  // Find existing policy by content equality
  let existingPolicyKey: PolicyId.PolicyId | undefined
  for (const key of mint.map.keys()) {
    if (Equal.equals(key, policyId)) {
      existingPolicyKey = key
      break
    }
  }

  if (existingPolicyKey === undefined) {
    return mint // Policy not found, nothing to remove
  }

  const result = new Map(mint.map)
  result.delete(existingPolicyKey)
  return new Mint({ map: result })
}

/**
 * Remove an asset from the Mint.
 * Uses content-based equality (Equal.equals) to find matching PolicyId and AssetName.
 *
 * @since 2.0.0
 * @category transformation
 */
export const removeAsset = (mint: Mint, policyId: PolicyId.PolicyId, assetName: AssetName.AssetName): Mint => {
  // Find existing policy by content equality
  let existingPolicyKey: PolicyId.PolicyId | undefined
  let existingAssetMap: Map<AssetName.AssetName, NonZeroInt64.NonZeroInt64> | undefined

  for (const [key, value] of mint.map.entries()) {
    if (Equal.equals(key, policyId)) {
      existingPolicyKey = key
      existingAssetMap = value
      break
    }
  }

  if (existingAssetMap === undefined || existingPolicyKey === undefined) {
    return mint // No assets for this policy, nothing to remove
  }

  // Find existing asset by content equality
  let existingAssetKey: AssetName.AssetName | undefined
  for (const key of existingAssetMap.keys()) {
    if (Equal.equals(key, assetName)) {
      existingAssetKey = key
      break
    }
  }

  if (existingAssetKey === undefined) {
    return mint // Asset not found, nothing to remove
  }

  const updatedAssets = new Map(existingAssetMap)
  updatedAssets.delete(existingAssetKey)

  if (updatedAssets.size === 0) {
    // If no assets left, remove the policyId entry
    const result = new Map(mint.map)
    result.delete(existingPolicyKey)
    return new Mint({ map: result })
  }

  const result = new Map(mint.map)
  result.delete(existingPolicyKey)
  result.set(existingPolicyKey, updatedAssets)
  return new Mint({ map: result })
}

/**
 * Get the amount for a specific policy and asset.
 * Uses content-based equality (Equal.equals) to find matching PolicyId and AssetName.
 *
 * @since 2.0.0
 * @category transformation
 */
export const get = (mint: Mint, policyId: PolicyId.PolicyId, assetName: AssetName.AssetName) => {
  // Find policy by content equality
  let existingAssetMap: Map<AssetName.AssetName, NonZeroInt64.NonZeroInt64> | undefined

  for (const [key, value] of mint.map.entries()) {
    if (Equal.equals(key, policyId)) {
      existingAssetMap = value
      break
    }
  }

  if (existingAssetMap === undefined) {
    return undefined
  }

  // Find asset by content equality
  for (const [key, value] of existingAssetMap.entries()) {
    if (Equal.equals(key, assetName)) {
      return value
    }
  }

  return undefined
}

/**
 * Check if Mint contains a specific policy and asset.
 *
 * @since 2.0.0
 * @category predicates
 */
export const has = (mint: Mint, policyId: PolicyId.PolicyId, assetName: AssetName.AssetName): boolean =>
  get(mint, policyId, assetName) !== undefined

/**
 * Get an asset amount by policy ID hex and asset name hex strings.
 * Convenience function for tests and lookups using hex strings.
 *
 * @since 2.0.0
 * @category lookup
 */
export const getByHex = (
  mint: Mint,
  policyIdHex: string,
  assetNameHex: string
): NonZeroInt64.NonZeroInt64 | undefined => {
  const policyId = PolicyId.fromHex(policyIdHex)
  const assetName = AssetName.fromHex(assetNameHex)
  return get(mint, policyId, assetName)
}

/**
 * Get the asset map for a specific policy by hex string.
 * Uses content-based equality (Equal.equals) to find matching PolicyId.
 *
 * @since 2.0.0
 * @category lookup
 */
export const getAssetsByPolicyHex = (
  mint: Mint,
  policyIdHex: string
): Map<AssetName.AssetName, NonZeroInt64.NonZeroInt64> | undefined => {
  const policyId = PolicyId.fromHex(policyIdHex)

  for (const [key, value] of mint.map.entries()) {
    if (Equal.equals(key, policyId)) {
      return value
    }
  }

  return undefined
}

/**
 * Check if Mint is empty.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isEmpty = (mint: Mint): boolean => mint.map.size === 0

/**
 * Get the number of policies in the Mint.
 *
 * @since 2.0.0
 * @category transformation
 */
export const policyCount = (mint: Mint): number => mint.map.size

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Mint): void => {
  w.writeMapHeader(v.map.size)
  for (const [policyId, assetMap] of v.map) {
    PolicyId.write(w, policyId)
    w.writeMapHeader(assetMap.size)
    for (const [assetName, amount] of assetMap) {
      AssetName.write(w, assetName)
      if (amount >= 0n) w.writeUint(amount)
      else w.writeNint(amount)
    }
    w.writeMapBreak()
  }
  w.writeMapBreak()
}

export const read = (r: CborReader): Mint => {
  const outerCount = r.readMapHeader()
  const map = new Map<PolicyId.PolicyId, AssetMap>()
  const readPolicy = () => {
    const policyId = PolicyId.read(r)
    const innerCount = r.readMapHeader()
    const assetMap = new Map<AssetName.AssetName, NonZeroInt64.NonZeroInt64>()
    const readAsset = () => {
      const assetName = AssetName.read(r)
      const amount = r.readInt() as NonZeroInt64.NonZeroInt64
      assetMap.set(assetName, amount)
    }
    if (innerCount === -1) { while (!r.isBreak()) readAsset() }
    else { for (let i = 0; i < innerCount; i++) readAsset() }
    map.set(policyId, assetMap)
  }
  if (outerCount === -1) { while (!r.isBreak()) readPolicy() }
  else { for (let i = 0; i < outerCount; i++) readPolicy() }
  return new Mint({ map })
}
/**
 * CBOR bytes transformation schema for Mint.
 * Transforms between CBOR bytes and Mint using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Mint),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Mint.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Mint.
 * Transforms between CBOR hex string and Mint using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Mint.FromCBORHex" })

/**
 * FastCheck arbitrary for generating random Mint instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<Mint> = FastCheck.oneof(
  // Sometimes generate an empty mint map
  FastCheck.constant(empty()),
  // Non-empty unique policies with unique assets per policy
  FastCheck.uniqueArray(PolicyId.arbitrary, {
    minLength: 1,
    maxLength: 5,
    selector: (p) => Bytes.toHex(p.hash)
  }).chain((policies) => {
    const assetsForPolicy = () =>
      FastCheck.uniqueArray(AssetName.arbitrary, {
        minLength: 1,
        maxLength: 5,
        selector: (a) => Bytes.toHex(a.bytes)
      }).chain((names) =>
        FastCheck.array(NonZeroInt64.arbitrary, {
          minLength: names.length,
          maxLength: names.length
        }).map((amounts) => names.map((n, i) => [n, amounts[i]] as const))
      )

    return FastCheck.array(assetsForPolicy(), { minLength: policies.length, maxLength: policies.length }).map(
      (assetsEntries) =>
        fromEntries(
          policies.map((policy, idx) => [
            policy,
            assetsEntries[idx] as Array<[AssetName.AssetName, NonZeroInt64.NonZeroInt64]>
          ])
        )
    )
  })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse Mint from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse Mint from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode Mint to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (mint: Mint, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, mint)
  return w.finishView()
}

/**
 * Encode Mint to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (mint: Mint, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(mint, profile))
