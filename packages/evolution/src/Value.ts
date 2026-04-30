import { Equal, FastCheck, Hash, Inspectable, Option, ParseResult, Schema } from "effect"

import * as AssetName from "./AssetName.js"
import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as MultiAsset from "./MultiAsset.js"
import * as PolicyId from "./PolicyId.js"
import type * as PositiveCoin from "./PositiveCoin.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for Value representing both ADA and native assets.
 *
 * ```
 * value = coin / [coin, multiasset<positive_coin>]
 * ```
 *
 * This can be either:
 * 1. Just a coin amount (lovelace only)
 * 2. A tuple of [coin, multiasset] (lovelace + native assets)
 *
 * @since 2.0.0
 * @category schemas
 */
export class OnlyCoin extends Schema.TaggedClass<OnlyCoin>("OnlyCoin")("OnlyCoin", {
  coin: Coin.Coin
}) {
  toJSON() {
    return {
      _tag: this._tag,
      coin: this.coin
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof OnlyCoin && Equal.equals(this.coin, that.coin)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.coin))
  }
}

export class WithAssets extends Schema.TaggedClass<WithAssets>("WithAssets")("WithAssets", {
  coin: Coin.Coin,
  assets: MultiAsset.MultiAsset
}) {
  toJSON() {
    return {
      _tag: this._tag,
      coin: this.coin,
      assets: this.assets
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof WithAssets && Equal.equals(this.coin, that.coin) && Equal.equals(this.assets, that.assets)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.coin) ^ Hash.hash(this.assets))
  }
}

export const Value = Schema.Union(OnlyCoin, WithAssets)
export type Value = typeof Value.Type

/**
 * Create a Value containing only ADA.
 *
 * @since 2.0.0
 * @category constructors
 */
export const onlyCoin = (ada: Coin.Coin) => new OnlyCoin({ coin: ada })

/**
 * Create a Value containing ADA and native assets.
 *
 * @since 2.0.0
 * @category constructors
 */
export const withAssets = (ada: Coin.Coin, assets: MultiAsset.MultiAsset) => new WithAssets({ coin: ada, assets })

/**
 * Extract the ADA amount from a Value.
 *
 * @since 2.0.0
 * @category transformation
 */
export const getAda = (value: Value): Coin.Coin => {
  return value.coin
}

/**
 * Extract the MultiAsset from a Value, if it exists.
 *
 * @since 2.0.0
 * @category transformation
 */
export const getAssets = (value: Value): Option.Option<MultiAsset.MultiAsset> => {
  if (value._tag === "OnlyCoin") {
    return Option.none()
  } else {
    return Option.some(value.assets)
  }
}

/**
 * Check if a Value contains only ADA (no native assets).
 *
 * @since 2.0.0
 * @category predicates
 */
export const isAdaOnly = (value: Value): value is OnlyCoin => value._tag === "OnlyCoin"

/**
 * Check if a Value contains native assets.
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasAssets = (value: Value): value is WithAssets => value._tag === "WithAssets"

/**
 * Add two Values together.
 * Combines ADA amounts and merges MultiAssets.
 *
 * @since 2.0.0
 * @category transformation
 */
export const add = (a: Value, b: Value): Value => {
  const adaA = getAda(a)
  const adaB = getAda(b)
  const totalAda = Coin.add(adaA, adaB)

  const assetsA = getAssets(a)
  const assetsB = getAssets(b)

  if (Option.isNone(assetsA) && Option.isNone(assetsB)) {
    return onlyCoin(totalAda)
  }

  if (Option.isSome(assetsA) && Option.isNone(assetsB)) {
    return withAssets(totalAda, assetsA.value)
  }

  if (Option.isNone(assetsA) && Option.isSome(assetsB)) {
    return withAssets(totalAda, assetsB.value)
  }

  // Both have assets - merge them properly
  if (Option.isSome(assetsA) && Option.isSome(assetsB)) {
    const mergedAssets = MultiAsset.merge(assetsA.value, assetsB.value)
    return withAssets(totalAda, mergedAssets)
  }

  return onlyCoin(totalAda)
}

/**
 * Subtract Value b from Value a.
 * Subtracts ADA amounts and MultiAssets properly.
 *
 * @since 2.0.0
 * @category transformation
 */
export const subtract = (a: Value, b: Value): Value => {
  const adaA = getAda(a)
  const adaB = getAda(b)
  const resultAda = Coin.subtract(adaA, adaB)

  const assetsA = getAssets(a)
  const assetsB = getAssets(b)

  // Both are ADA-only
  if (Option.isNone(assetsA) && Option.isNone(assetsB)) {
    return onlyCoin(resultAda)
  }

  // a has assets, b doesn't - keep a's assets
  if (Option.isSome(assetsA) && Option.isNone(assetsB)) {
    return withAssets(resultAda, assetsA.value)
  }

  // a doesn't have assets, b does - this would result in negative assets, throw error
  if (Option.isNone(assetsA) && Option.isSome(assetsB)) {
    throw new Error("Cannot subtract assets from Value with no assets")
  }

  // Both have assets - subtract them properly
  if (Option.isSome(assetsA) && Option.isSome(assetsB)) {
    try {
      const subtractedAssets = MultiAsset.subtract(assetsA.value, assetsB.value)
      return withAssets(resultAda, subtractedAssets)
    } catch {
      // If subtraction results in empty MultiAsset, return ADA-only value
      return onlyCoin(resultAda)
    }
  }

  return onlyCoin(resultAda)
}

/**
 * Check if Value a is greater than or equal to Value b.
 * This means after subtracting b from a, the result would not be negative.
 *
 * @since 2.0.0
 * @category ordering
 */
export const geq = (a: Value, b: Value): boolean => {
  try {
    subtract(a, b)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a value is a valid Value.
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = (value: unknown): value is Value => Schema.is(Value)(value)

/**
 * Generate a random Value.
 *
 * @since 2.0.0
 * @category generators
 */
export const arbitrary: FastCheck.Arbitrary<Value> = FastCheck.oneof(
  Coin.arbitrary.map((coin) => new OnlyCoin({ coin })),
  FastCheck.record({ assets: MultiAsset.arbitrary, coin: Coin.arbitrary }).map(
    ({ assets, coin }) => new WithAssets({ assets, coin })
  )
)

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

const writeMultiAsset = (w: CborWriter, ma: MultiAsset.MultiAsset): void => {
  w.writeMapHeader(ma.map.size)
  for (const [policyId, assetMap] of ma.map.entries()) {
    PolicyId.write(w, policyId)
    w.writeMapHeader(assetMap.size)
    for (const [assetName, amount] of assetMap.entries()) {
      AssetName.write(w, assetName)
      if (amount >= 0n) w.writeUint(amount)
      else w.writeNint(amount)
    }
    w.writeMapBreak()
  }
  w.writeMapBreak()
}

const readMultiAsset = (r: CborReader): MultiAsset.MultiAsset => {
  const outerCount = r.readMapHeader()
  const map = new Map<PolicyId.PolicyId, MultiAsset.AssetMap>()
  const readEntry = () => {
    const policyId = PolicyId.read(r)
    const innerCount = r.readMapHeader()
    const assetMap = new Map<AssetName.AssetName, PositiveCoin.PositiveCoin>()
    const readInner = () => {
      const assetName = AssetName.read(r)
      const amount = r.readInt() as PositiveCoin.PositiveCoin
      assetMap.set(assetName, amount)
    }
    if (innerCount === -1) { while (!r.isBreak()) readInner() }
    else { for (let i = 0; i < innerCount; i++) readInner() }
    map.set(policyId, assetMap)
  }
  if (outerCount === -1) { while (!r.isBreak()) readEntry() }
  else { for (let i = 0; i < outerCount; i++) readEntry() }
  return new MultiAsset.MultiAsset({ map })
}

export const write = (w: CborWriter, v: Value): void => {
  if (v._tag === "OnlyCoin") {
    w.writeUint(v.coin)
  } else {
    w.writeArrayHeader(2)
    w.writeUint(v.coin)
    writeMultiAsset(w, v.assets)
    w.writeArrayBreak()
  }
}

export const read = (r: CborReader): Value => {
  const mt = r.peekMajorType()
  if (mt === 0) {
    // Just a coin (unsigned integer)
    return new OnlyCoin({ coin: r.readUint() as Coin.Coin })
  } else if (mt === 4) {
    // Array [coin, multiasset]
    const count = r.readArrayHeader()
    const coin = r.readUint() as Coin.Coin
    const assets = readMultiAsset(r)
    if (count === -1) r.isBreak()
    return new WithAssets({ coin, assets })
  }
  throw new Error(`Value: expected integer (major type 0) or array (major type 4), got major type ${mt}`)
}

/**
 * CBOR bytes transformation schema for Value.
 * Transforms between CBOR bytes and Value using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Value),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Value.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Value.FromCBORHex" })

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse Value from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse Value from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode Value to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: Value, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode Value to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: Value, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
