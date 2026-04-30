import { blake2b } from "@noble/hashes/blake2"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as CostModel from "./CostModel.js"
import * as Data from "./Data.js"
import * as Redeemer from "./Redeemer.js"
import * as ScriptDataHash from "./ScriptDataHash.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

// ============================================================================
// Shared helpers
// ============================================================================

const arrayEquals = <A>(a: ReadonlyArray<A>, b: ReadonlyArray<A>): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Equal.equals(a[i], b[i])) return false
  }
  return true
}

const arrayHash = <A>(arr: ReadonlyArray<A>): number => {
  let hash = 0
  for (const item of arr) {
    hash = Hash.combine(hash)(Hash.hash(item))
  }
  return hash
}

// ============================================================================
// Map key type  
// ============================================================================

/**
 * A redeemer map key: `[tag, index]`.
 *
 * Mirrors the CDDL: `[tag : redeemer_tag, index : uint .size 4]`
 *
 * @since 2.0.0
 * @category model
 */
export type RedeemerKey = readonly [Redeemer.RedeemerTag, bigint]

/**
 * Create a string key from a RedeemerKey for lookup convenience.
 *
 * @since 2.0.0
 * @category utilities
 */
export const keyToString = ([tag, index]: RedeemerKey): string => `${tag}:${index}`

// ============================================================================
// Map entry value type
// ============================================================================

/**
 * A redeemer map entry value: `[data, ex_units]`.
 *
 * Mirrors the CDDL: `[data : plutus_data, ex_units : ex_units]`
 *
 * @since 2.0.0
 * @category model
 */
export class RedeemerValue extends Schema.Class<RedeemerValue>("RedeemerValue")({
  data: Schema.typeSchema(Data.DataSchema),
  exUnits: Redeemer.ExUnits
}) {
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof RedeemerValue && Data.equals(this.data, that.data) && Equal.equals(this.exUnits, that.exUnits)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.data))(Hash.hash(this.exUnits)))
  }
}

// ============================================================================
// Domain types — discriminated union (Credential pattern)
// ============================================================================

/**
 * Redeemers in map format (Conway recommended).
 *
 * Mirrors the CDDL exactly:
 * ```
 * { + [tag : redeemer_tag, index : uint .size 4] => [ data : plutus_data, ex_units : ex_units ] }
 * ```
 *
 * The map is keyed by `[tag, index]` tuples. Note: JS Map uses reference
 * equality for non-primitive keys, so lookups by tuple won't work — use
 * `get()` or `toArray()` helpers instead.
 *
 * @since 2.0.0
 * @category model
 */
export class RedeemerMap extends Schema.TaggedClass<RedeemerMap>()("RedeemerMap", {
  value: Schema.Map({
    key: Schema.Tuple(Redeemer.RedeemerTag, Schema.BigIntFromSelf),
    value: Schema.typeSchema(RedeemerValue)
  })
}) {
  /**
   * Look up a redeemer entry by tag and index.
   *
   * @since 2.0.0
   * @category accessors
   */
  get(tag: Redeemer.RedeemerTag, index: bigint): RedeemerValue | undefined {
    for (const [[t, i], v] of this.value) {
      if (t === tag && i === index) return v
    }
    return undefined
  }

  /**
   * Number of redeemer entries.
   *
   * @since 2.0.0
   * @category accessors
   */
  get size(): number {
    return this.value.size
  }

  /**
   * Convert to an array of `Redeemer` objects (convenience for consumers).
   *
   * @since 2.0.0
   * @category conversions
   */
  toArray(): ReadonlyArray<Redeemer.Redeemer> {
    const result: Array<Redeemer.Redeemer> = []
    for (const [[tag, index], { data, exUnits }] of this.value) {
      result.push(new Redeemer.Redeemer({ tag, index, data, exUnits }))
    }
    return result
  }

  toJSON() {
    return {
      _tag: "RedeemerMap" as const,
      entries: Array.from(this.value.entries()).map(([[tag, index], { data, exUnits }]) => ({
        key: { tag, index: index.toString() },
        value: { data, exUnits: exUnits.toJSON() }
      }))
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    if (!(that instanceof RedeemerMap)) return false
    if (this.value.size !== that.value.size) return false
    // Order-insensitive: sort both by [tag, index] then compare Redeemer objects
    // (Redeemer is a TaggedClass with proper Equal support, unlike raw Data.Data)
    const sortKey = (r: Redeemer.Redeemer) => `${r.tag}:${r.index}`
    const sortedThis = [...this.toArray()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    const sortedThat = [...that.toArray()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    return arrayEquals(sortedThis, sortedThat)
  }

  [Hash.symbol](): number {
    // Order-insensitive: sort by key then hash the sorted array
    const sortKey = (r: Redeemer.Redeemer) => `${r.tag}:${r.index}`
    const sorted = [...this.toArray()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    return Hash.cached(this, arrayHash(sorted))
  }
}

/**
 * Create a `RedeemerMap` from an array of `Redeemer` objects.
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeRedeemerMap = (redeemers: ReadonlyArray<Redeemer.Redeemer>): RedeemerMap => {
  const map = new Map<RedeemerKey, RedeemerValue>()
  for (const r of redeemers) {
    const key: RedeemerKey = [r.tag, r.index]
    // Detect semantic duplicates (same tag + index)
    for (const [existingKey] of map) {
      if (existingKey[0] === key[0] && existingKey[1] === key[1]) {
        throw new Error(`Duplicate redeemer key: [${key[0]}, ${key[1]}]`)
      }
    }
    map.set(key, new RedeemerValue({ data: r.data, exUnits: r.exUnits }))
  }
  return new RedeemerMap({ value: map })
}

/**
 * Redeemers in legacy array format.
 *
 * Mirrors the CDDL:
 * ```
 * [ + redeemer ]
 * ```
 *
 * Backwards compatible — will be deprecated in the next era.
 * Prefer `RedeemerMap` for new transactions.
 *
 * @since 2.0.0
 * @category model
 */
export class RedeemerArray extends Schema.TaggedClass<RedeemerArray>()("RedeemerArray", {
  value: Schema.Array(Redeemer.Redeemer)
}) {
  /**
   * Number of redeemer entries.
   *
   * @since 2.0.0
   * @category accessors
   */
  get size(): number {
    return this.value.length
  }

  /**
   * Convert to an array of `Redeemer` objects (identity for array format).
   *
   * @since 2.0.0
   * @category conversions
   */
  toArray(): ReadonlyArray<Redeemer.Redeemer> {
    return this.value
  }

  toJSON() {
    return {
      _tag: "RedeemerArray" as const,
      value: this.value.map((r) => r.toJSON())
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof RedeemerArray && arrayEquals(this.value, that.value)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, arrayHash(this.value))
  }
}

/**
 * Union schema for redeemers — accepts either map or array format.
 * Follows the Credential pattern: `Credential = Union(KeyHash, ScriptHash)`.
 *
 * @since 2.0.0
 * @category schemas
 */
export const Redeemers = Schema.Union(RedeemerMap, RedeemerArray)

/**
 * Union type: `RedeemerMap | RedeemerArray`
 *
 * @since 2.0.0
 * @category model
 */
export type Redeemers = typeof Redeemers.Type

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

/**
 * Write RedeemerArray: `[ + redeemer ]`
 * Each redeemer is `[tag, index, data, ex_units]`
 */
export const writeArray = (w: CborWriter, v: RedeemerArray): void => {
  w.writeArrayHeader(v.value.length)
  for (const r of v.value) Redeemer.write(w, r)
  w.writeArrayBreak()
}

/**
 * Read RedeemerArray: `[ + redeemer ]`
 */
export const readArray = (r: CborReader): RedeemerArray => {
  const count = r.readArrayHeader()
  const redeemers: Array<Redeemer.Redeemer> = []
  if (count === -1) {
    while (!r.isBreak()) redeemers.push(Redeemer.read(r))
  } else {
    for (let i = 0; i < count; i++) redeemers.push(Redeemer.read(r))
  }
  return new RedeemerArray({ value: redeemers })
}

/**
 * Write RedeemerMap: `{ + [tag, index] => [data, ex_units] }`
 */
export const writeMap = (w: CborWriter, v: RedeemerMap): void => {
  w.writeMapHeader(v.value.size)
  for (const [[tag, index], { data, exUnits }] of v.value) {
    // Key: [tag, index]
    w.writeArrayHeader(2)
    w.writeSmallUint(Number(Redeemer.tagToInteger(tag)))
    w.writeUint(index)
    w.writeArrayBreak()
    // Value: [data, ex_units]
    w.writeArrayHeader(2)
    Data.write(w, data, CBOR.CML_DEFAULT_OPTIONS)
    Redeemer.writeExUnits(w, exUnits)
    w.writeArrayBreak()
  }
  w.writeMapBreak()
}

/**
 * Read RedeemerMap: `{ + [tag, index] => [data, ex_units] }`
 */
export const readMap = (r: CborReader): RedeemerMap => {
  const count = r.readMapHeader()
  const map = new Map<RedeemerKey, RedeemerValue>()

  const readEntry = () => {
    // Key: [tag, index]
    const keyCount = r.readArrayHeader()
    const tagInt = BigInt(r.readSmallUint())
    const tag = Redeemer.integerToTag(tagInt)
    const index = r.readUint()
    if (keyCount === -1) r.isBreak()
    // Value: [data, ex_units]
    const valCount = r.readArrayHeader()
    const data = Data.read(r)
    const exUnits = Redeemer.readExUnits(r)
    if (valCount === -1) r.isBreak()
    map.set([tag, index] as RedeemerKey, new RedeemerValue({ data, exUnits }))
  }

  if (count === -1) {
    while (!r.isBreak()) readEntry()
  } else {
    for (let i = 0; i < count; i++) readEntry()
  }
  return new RedeemerMap({ value: map })
}

/**
 * Write any Redeemers (dispatches on _tag).
 */
export const write = (w: CborWriter, v: Redeemers): void => {
  switch (v._tag) {
    case "RedeemerArray": writeArray(w, v); break
    case "RedeemerMap": writeMap(w, v); break
  }
}

/**
 * Read Redeemers — caller must know the format (array vs map).
 * Use readArray or readMap directly if format is known.
 * This default reads the array format.
 */
export const read = (r: CborReader): Redeemers => {
  // Peek at major type to distinguish array (4) vs map (5)
  const mt = r.peekMajorType()
  if (mt === 5) return readMap(r)
  return readArray(r)
}

// ============================================================================
// Schemas
// ============================================================================

/**
 * CBOR bytes transformation schema for Redeemers.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Redeemers),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Redeemers.FromCBORBytes" })

/**
 * CBOR hex schema.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Redeemers.FromCBORHex" })

/**
 * CBOR bytes schema for map format (alias for FromCBORBytes which auto-detects).
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytesMap = FromCBORBytes

/**
 * CBOR hex schema for map format (alias for FromCBORHex which auto-detects).
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHexMap = FromCBORHex

// ============================================================================
// Arbitrary
// ============================================================================

/**
 * FastCheck arbitrary for Redeemers — generates both map and array variants.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<Redeemers> = FastCheck.array(Redeemer.arbitrary, { maxLength: 5 }).chain(
  (redeemers) =>
    FastCheck.constantFrom<Redeemers>(makeRedeemerMap(redeemers), new RedeemerArray({ value: redeemers }))
)

// ============================================================================
// Convenience parse / encode functions
// ============================================================================

/**
 * Parse from CBOR bytes (array format).
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Parse from CBOR bytes (map format - alias, auto-detects format).
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytesMap = fromCBORBytes

/**
 * Parse from CBOR hex string (map format - alias, auto-detects format).
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHexMap = fromCBORHex

/**
 * Encode to CBOR bytes (array format).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: Redeemers, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(512, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode to CBOR hex string (array format).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: Redeemers, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Encode to CBOR bytes (map format).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytesMap = (data: Redeemers, profile?: EncodingProfile): Uint8Array =>
  toCBORBytes(data, profile)

/**
 * Encode to CBOR hex string (map format).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHexMap = (data: Redeemers, profile?: EncodingProfile): string =>
  toCBORHex(data, profile)

// ============================================================================
// Hashing
// ============================================================================

const encodeDatumsTaggedSet = (
  datums: ReadonlyArray<Data.Data>,
  options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS
): Uint8Array => {
  const items = datums.map((d) => Data.toCBORBytes(d, options))
  const arr = CBOR.encodeArrayAsDefinite(items)
  return CBOR.encodeTaggedValue(258, arr)
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
const concatBytes = (...arrays: ReadonlyArray<Uint8Array>): Uint8Array => {
  const totalLen = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

/**
 * Compute script_data_hash using standard module encoders.
 *
 * Accepts the concrete `Redeemers` union type — encoding format is determined
 * by `_tag` (`RedeemerMap` → map CBOR, `RedeemerArray` → array CBOR).
 *
 * The payload format per CDDL spec is raw concatenation (not a CBOR structure):
 * ```
 * redeemers_bytes || datums_bytes || language_views_bytes
 * ```
 *
 * @since 2.0.0
 * @category hashing
 */
export const toScriptDataHash = (
  redeemers: Redeemers,
  costModels: CostModel.CostModels,
  datums?: ReadonlyArray<Data.Data>,
  _options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS
): ScriptDataHash.ScriptDataHash => {
  const hasDatums = Array.isArray(datums) && datums.length > 0

  // Language views encoding (handles PlutusV1 indefinite-length quirk per spec)
  const langViewsBytes = CostModel.languageViewsEncoding(costModels)

  let payload: Uint8Array

  if (hasDatums && redeemers.size === 0) {
    // Special case (CDDL): [ A0 | tag(258) datums | A0 ]
    const datumsBytes = encodeDatumsTaggedSet(datums)
    payload = concatBytes(
      new Uint8Array([0xa0]), // Empty map
      datumsBytes,
      new Uint8Array([0xa0]) // Empty map
    )
  } else {
    // Encode redeemers based on concrete type
    const redeemersBytes = toCBORBytes(redeemers)
    const datumsBytes = hasDatums ? encodeDatumsTaggedSet(datums) : undefined

    payload = datumsBytes
      ? concatBytes(redeemersBytes, datumsBytes, langViewsBytes)
      : concatBytes(redeemersBytes, langViewsBytes)
  }

  const digest = blake2b(payload, { dkLen: 32 })
  return new ScriptDataHash.ScriptDataHash({ hash: digest })
}
