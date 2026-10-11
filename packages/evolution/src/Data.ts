import { blake2b } from "@noble/hashes/blake2.js"
import { Data as EffectData, Effect, Equal, FastCheck, Hash, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as DatumHash from "./DatumHash.js"
import * as Numeric from "./Numeric.js"
import * as OriginalBytes from "./OriginalBytes.js"

/**
 * Error class for Data related operations.
 *
 * @since 2.0.0
 * @category errors
 */
export class DataError extends EffectData.TaggedError("DataError")<{
  message?: string
  cause?: unknown
}> {}

/**
 * PlutusData encoded type (for JSON/CBOR encoding)
 * Based on Conway CDDL specification
 *
 * @since 2.0.0
 * @category model
 */
export type DataEncoded =
  // Constr (encoded with string index)
  | { readonly index: string; readonly fields: ReadonlyArray<DataEncoded> }
  // Map (encoded as array of [key, value] pairs)
  | ReadonlyArray<readonly [DataEncoded, DataEncoded]>
  // List
  | ReadonlyArray<DataEncoded>
  // Int (encoded as string)
  | string
  // ByteArray (encoded as hex string)
  | string

/**
 * PlutusData type definition (runtime type)
 * Based on Conway CDDL specification
 *
 * ```
 * CDDL: plutus_data =
 *   constr<plutus_data>
 *   / {* plutus_data => plutus_data}
 *   / [* plutus_data]
 *   / big_int
 *   / bounded_bytes
 *
 * constr<a0> =
 *   #6.121([* a0])
 *   / #6.122([* a0])
 *   / #6.123([* a0])
 *   / #6.124([* a0])
 *   / #6.125([* a0])
 *   / #6.126([* a0])
 *   / #6.127([* a0])
 *   / #6.102([uint, [* a0]])
 * ```
 *
 * Constructor Index Limits:
 * - Tags 121-127: Direct encoding for constructor indices 0-6
 * - Tag 102: General constructor encoding for any uint value
 * - Maximum constructor index: 2^64 - 1 (18,446,744,073,709,551,615)
 *   as per CBOR RFC 8949 specification for unsigned integers
 *
 * @since 2.0.0
 * @category model
 */
export type Data =
  // Constr (runtime with bigint index)
  | Constr
  // Map (using standard Map since Schema.Map produces Map<K,V>)
  | globalThis.Map<Data, Data>
  // List
  | ReadonlyArray<Data>
  // Int (runtime as bigint)
  | bigint
  // ByteArray (runtime as Uint8Array)
  | Uint8Array

/**
 * PlutusMap type alias
 *
 * @since 2.0.0
 * @category model
 */
export type Map = globalThis.Map<Data, Data>

/**
 * PlutusList type alias
 *
 * @since 2.0.0
 * @category model
 */
export type List = ReadonlyArray<Data>

/**
 * Constr schema for constructor alternatives
 *
 * @category schemas
 * @since 2.0.0
 */
export class Constr extends Schema.Class<Constr>("Constr")({
  index: Numeric.Uint64Schema.annotations({
    identifier: "Data.Constr.Index",
    title: "Constructor Index",
    description: "The index of the constructor, must be a non-negative integer"
  }),
  fields: Schema.Array(Schema.suspend((): Schema.Schema<Data, DataEncoded> => DataSchema)).annotations({
    identifier: "Data.Constr.Fields",
    title: "Fields of Constr",
    description: "A list of PlutusData fields for the constructor"
  })
}) {
  [Equal.symbol](that: unknown): boolean {
    return that instanceof Constr && equals(this, that)
  }

  [Hash.symbol](): number {
    return Hash.hash(this.index.toString() + this.fields.length)
  }
}

/**
 * Schema for PlutusMap data type
 *
 * @category schemas
 *
 * @since 2.0.0
 */
export const MapSchema = Schema.Map({
  key: Schema.suspend((): Schema.Schema<Data, DataEncoded> => DataSchema).annotations({
    identifier: "Data.Map.Key",
    title: "Map Key",
    description: "The key of the PlutusMap, must be a PlutusData type"
  }),
  value: Schema.suspend((): Schema.Schema<Data, DataEncoded> => DataSchema).annotations({
    identifier: "Data.Map.Value",
    title: "Map Value",
    description: "The value of the PlutusMap, must be a PlutusData type"
  })
}).annotations({
  identifier: "Data.Map",
  title: "PlutusMap",
  description: "A map of PlutusData key-value pairs"
})

/**
 * Schema for PlutusList data type
 *
 * @category schemas
 *
 * @since 2.0.0
 */
export const ListSchema = Schema.Array(Schema.suspend((): Schema.Schema<Data, DataEncoded> => DataSchema)).annotations({
  identifier: "Data.List"
})

/**
 * Schema for PlutusBigInt data type
 *
 * Matches the CDDL specification for big_int:
 * ```
 * big_int = int / big_uint / big_nint
 * big_uint = #6.2(bounded_bytes)
 * big_nint = #6.3(bounded_bytes)
 * ```
 *
 * Where:
 * - `int` covers integers that fit in CBOR major types 0 and 1 (0 to 2^64-1 for positive, -(2^64-1) to -1 for negative)
 * - `big_uint` (tag 2) covers positive integers larger than 2^64-1
 * - `big_nint` (tag 3) covers negative integers smaller than -(2^64-1)
 *
 * Note: JavaScript's Number.MAX_SAFE_INTEGER (2^53-1) is much smaller than CBOR's 64-bit limit.
 *
 * @category schemas
 *
 * @since 2.0.0
 */
export const IntSchema = Schema.BigInt.annotations({
  identifier: "Data.Int"
})
export type Int = typeof IntSchema.Type

/**
 * Schema for PlutusBytes data type
 *
 * @category schemas
 *
 * @since 2.0.0
 */
export const ByteArray = Schema.Uint8ArrayFromHex.annotations({
  identifier: "Data.ByteArray"
})
export type ByteArray = typeof ByteArray.Type

export interface DataSchema extends Schema.SchemaClass<Data, DataEncoded> {}

/**
 * Combined schema for PlutusData type with proper recursion
 *
 * @category schemas
 *
 * @since 2.0.0
 */
export const DataSchema: DataSchema = Schema.Union(
  // Map: ReadonlyArray<[DataEncoded, DataEncoded]> <-> Map<Data, Data>
  MapSchema,

  // List: ReadonlyArray<DataEncoded> <-> ReadonlyArray<Data>
  ListSchema,

  // Int: string <-> bigint
  IntSchema,

  // ByteArray: hex string <-> Uint8Array
  ByteArray,

  // Constr: { index: string, fields: DataEncoded[] } <-> Constr { index: bigint, fields: Data[] }
  Constr
).annotations({
  identifier: "DataSchema"
})

/**
 * Type guard to check if a value is a Constr
 *
 * @category predicates
 *
 * @since 2.0.0
 */
export const isConstr = (data: unknown): data is Constr => Schema.is(Constr)(data)

/**
 * Type guard to check if a value is a PlutusMap
 *
 * @category predicates
 *
 * @since 2.0.0
 */
export const isMap = Schema.is(MapSchema)

/**
 * Type guard to check if a value is a PlutusList
 *
 * @category predicates
 *
 * @since 2.0.0
 */
export const isList = Schema.is(ListSchema)

/**
 * Type guard to check if a value is a PlutusBigInt
 *
 * @category predicates
 *
 * @since 2.0.0
 */
export const isInt = Schema.is(IntSchema)

/**
 * Type guard to check if a value is a PlutusBytes
 *
 * @category predicates
 *
 * @since 2.0.0
 */
export const isBytes = Schema.is(ByteArray)

/**
 * A `Data` checked where it stands, with nothing rebuilt.
 *
 * ⚠️ **Use this for a class field or any other slot that holds an already-decoded `Data`.**
 * {@link DataSchema} is a transforming schema, and validating a value through it returns a
 * STRUCTURAL COPY: a list comes back as a different array holding the same elements. That is
 * invisible until something keys on identity, and {@link OriginalBytes} does -- so a datum decoded
 * from the wire and handed to `Redeemer.spend` arrived with its bytes and reached the encoder
 * without them, which reframed an empty indefinite list and moved `script_data_hash`.
 *
 * `Schema.declare` with a type guard performs no transformation, so the value that goes in is the
 * value that comes out.
 *
 * @since 2.8.0
 * @category schemas
 */
export const DataValue: Schema.Schema<Data> = Schema.declare(
  (input: unknown): input is Data =>
    typeof input === "bigint" ||
    input instanceof Uint8Array ||
    isConstr(input) ||
    (globalThis.Array.isArray(input) && input.every(isData)) ||
    (input instanceof globalThis.Map &&
      globalThis.Array.from(input.entries()).every(([key, value]) => isData(key) && isData(value))),
  {
    identifier: "Data.DataValue",
    title: "Plutus Data, checked in place",
    description: "A Data value validated without being rebuilt, so its provenance record survives"
  }
)

/**
 * Whether a value is a {@link Data}, checked structurally and without rebuilding it.
 *
 * @since 2.8.0
 * @category predicates
 */
export const isData = (input: unknown): input is Data => Schema.is(DataValue)(input)

/**
 * Creates a constructor with the specified index and data
 *
 * @since 2.0.0
 * @category constructors
 */
export const constr = (index: bigint, fields: Array<Data>): Constr => Constr.make({ index, fields })

/**
 * Creates a Plutus map from key-value pairs
 *
 * @since 2.0.0
 * @category constructors
 */
export const map = (entries: Array<[key: Data, value: Data]>): Map => new globalThis.Map(entries)

/**
 * Creates a Plutus list from items
 *
 * @since 2.0.0
 * @category constructors
 */
export const list = (list: Array<Data>): List => list

/**
 * Creates Plutus big integer
 *
 * @since 2.0.0
 * @category constructors
 */
export const int = (integer: bigint): Int => Schema.decodeSync(Schema.typeSchema(IntSchema))(integer)

/**
 * Creates Plutus bounded bytes from hex string
 *
 * @since 2.0.0
 * @category constructors
 */
export const bytearray = (bytes: string): ByteArray => Schema.decodeSync(ByteArray)(bytes)

/**
 * Pattern matching helper for Constr types
 *
 * @since 2.0.0
 * @category utilities
 */
export const matchConstr = <T>(
  constr: Constr,
  cases: {
    [key: number]: (fields: ReadonlyArray<Data>) => T
    _: (index: number, fields: ReadonlyArray<Data>) => T
  }
): T => {
  const specificCase = cases[Number(constr.index)]
  if (specificCase) {
    return specificCase(constr.fields)
  }
  return cases._(Number(constr.index), constr.fields)
}

/**
 * Pattern matching helper for PlutusData types
 *
 * @since 2.0.0
 * @category utilities
 */
export const matchData = <T>(
  data: Data,
  cases: {
    Map: (entries: ReadonlyArray<[Data, Data]>) => T
    List: (items: ReadonlyArray<Data>) => T
    Int: (value: bigint) => T
    Bytes: (bytes: Uint8Array) => T
    Constr: (constr: Constr) => T
  }
): T => {
  if (isMap(data)) {
    return cases.Map(Array.from(data.entries()))
  }
  if (isList(data)) {
    return cases.List(data)
  }
  if (isInt(data)) {
    return cases.Int(data)
  }
  if (isBytes(data)) {
    return cases.Bytes(data)
  }
  if (isConstr(data)) {
    return cases.Constr(data)
  }
  // If we reach here, it means the data is not a recognized PlutusData type
  throw new DataError({
    message: `Unsupported PlutusData type: ${typeof data === "bigint" ? String(data) : String(data)}`
  })
}

/**
 * Creates an arbitrary that generates PlutusData values with controlled depth
 *
 * @category generators
 *
 * @since 2.0.0
 */
export const arbitraryPlutusData = (depth: number = 3): FastCheck.Arbitrary<Data> => {
  if (depth <= 0) {
    // Base cases: PlutusBigInt or PlutusBytes
    return FastCheck.oneof(arbitraryPlutusBigInt(), arbitraryPlutusBytes())
  }

  // Recursive cases with decreasing depth
  return FastCheck.oneof(
    arbitraryPlutusBigInt(),
    arbitraryPlutusBytes(),
    arbitraryConstr(depth - 1),
    arbitraryPlutusList(depth - 1),
    arbitraryPlutusMap(depth - 1)
  )
}

/**
 * Creates an arbitrary that generates PlutusBytes values
 *
 * @category generators
 *
 * @since 2.0.0
 */
export const arbitraryPlutusBytes = (): FastCheck.Arbitrary<Uint8Array> =>
  FastCheck.uint8Array({
    minLength: 0, // Allow empty arrays (valid for PlutusBytes)
    maxLength: 32 // Max 32 bytes
  })

/**
 * Creates an arbitrary that generates PlutusBigInt values
 *
 * @category generators
 *
 * @since 2.0.0
 */
export const arbitraryPlutusBigInt = (): FastCheck.Arbitrary<bigint> => FastCheck.bigInt()

/**
 * Creates an arbitrary that generates PlutusList values
 *
 * @category generators
 *
 * @since 2.0.0
 */
export const arbitraryPlutusList = (depth: number): FastCheck.Arbitrary<List> =>
  FastCheck.array(arbitraryPlutusData(depth), {
    minLength: 0,
    maxLength: 5
  }).map((value) => list(value))

/**
 * Creates an arbitrary that generates Constr values
 *
 * @category generators
 *
 * @since 2.0.0
 */
export const arbitraryConstr = (depth: number): FastCheck.Arbitrary<Constr> =>
  FastCheck.tuple(
    FastCheck.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
    FastCheck.array(arbitraryPlutusData(depth), {
      minLength: 0,
      maxLength: 5
    })
  ).map(([index, data]) => constr(index, data))

/**
 * Creates an arbitrary that generates PlutusMap values with unique keys
 * Following a similar distribution pattern:
 * - 60% PlutusBigInt keys
 * - 30% PlutusBytes keys
 * - 10% Complex keys
 *
 * @category generators
 *
 * @since 2.0.0
 */
export const arbitraryPlutusMap = (depth: number): FastCheck.Arbitrary<Map> => {
  // Helper to create key-value pairs with unique keys
  const uniqueKeyValuePairs = <T extends Data>(keyGen: FastCheck.Arbitrary<T>, maxSize: number) =>
    FastCheck.uniqueArray(FastCheck.tuple(keyGen, arbitraryPlutusData(depth > 0 ? depth - 1 : 0)), {
      minLength: 0,
      maxLength: maxSize * 2, // Generate more than needed to increase chance of unique keys
      selector: (pair) => {
        // Use a simple string representation for unique key identification
        // Handle BigInt safely by converting to string first
        const keyStr = typeof pair[0] === "bigint" ? String(pair[0]) : JSON.stringify(pair[0])
        return keyStr
      }
    })

  // PlutusBigInt keys (more frequent)
  const bigIntPairs = uniqueKeyValuePairs(arbitraryPlutusBigInt(), 3)

  // PlutusBytes keys (medium frequency)
  const bytesPairs = uniqueKeyValuePairs(arbitraryPlutusBytes(), 3)

  // Complex keys (less frequent)
  const complexPairs = uniqueKeyValuePairs(arbitraryPlutusData(depth > 1 ? depth - 2 : 0), 2)

  return FastCheck.oneof(bigIntPairs, bytesPairs, complexPairs).map((pairs) => map(pairs))
}

/**
 * FastCheck arbitrary for PlutusData types
 *
 * @since 2.0.0
 * @category generators
 */
export const arbitrary = arbitraryPlutusData(3)

// ============================================================================
// Transformations
// ============================================================================

/**
 * Default CBOR options for Data encoding/decoding: {@link CBOR.PLUTUS_DATA_OPTIONS},
 * the layout the node writes.
 *
 * @since 2.0.0
 * @category constants
 */
export const DEFAULT_CBOR_OPTIONS = CBOR.PLUTUS_DATA_OPTIONS

/**
 * Convert a big-endian byte array to a positive bigint
 * Used for CBOR tag 2/3 decoding
 */
const bytesToBigint = (bytes: Uint8Array): bigint => {
  if (bytes.length === 0) {
    return 0n
  }

  let result = 0n
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i])
  }

  return result
}

// ============================================================================
// Encoding
// ============================================================================

// The layout choices that CodecOptions make for Plutus data, read once per call
type Layout = {
  /**
   * Whether bytes a node arrived as outrank the representation this layout would choose.
   *
   * ⚠️ True for every option set except `mode: "canonical"`. Canonicalising IS a request for a
   * new representation, and a caller passing it accepts the different hash that comes with it.
   * Every other option set describes a house style for values the encoder is choosing bytes for,
   * and says nothing about bytes already chosen — a datum decoded from the chain and written back
   * must be the bytes that were hashed, or a script consumer matching on its hash stops matching.
   */
  keepArrival: boolean
  readonly indefiniteArrays: boolean
  readonly indefiniteMaps: boolean
  readonly sortMapKeys: boolean
  readonly minimal: boolean
  readonly mapsAsPairs: boolean
}

const toLayout = (options: CBOR.CodecOptions): Layout =>
  options.mode === "custom"
    ? {
        keepArrival: true,
        indefiniteArrays: options.useIndefiniteArrays,
        indefiniteMaps: options.useIndefiniteMaps,
        sortMapKeys: options.sortMapKeys,
        minimal: options.useMinimalEncoding,
        mapsAsPairs: options.encodeMapAsPairs === true
      }
    : {
        keepArrival: options.mode !== "canonical",
        indefiniteArrays: false,
        indefiniteMaps: false,
        sortMapKeys: true,
        minimal: true,
        mapsAsPairs: options.encodeMapAsPairs === true
      }

const MAX_UINT64 = 0xffffffffffffffffn
const BYTES_CHUNK_SIZE = 64

// A growable output buffer
type Writer = { buf: Uint8Array; pos: number }

const reserve = (w: Writer, n: number): void => {
  if (w.pos + n <= w.buf.length) return
  let size = w.buf.length * 2
  while (size < w.pos + n) size *= 2
  const buf = new Uint8Array(size)
  buf.set(w.buf.subarray(0, w.pos))
  w.buf = buf
}

const writeByte = (w: Writer, b: number): void => {
  reserve(w, 1)
  w.buf[w.pos++] = b
}

const writeBytes = (w: Writer, bytes: Uint8Array): void => {
  reserve(w, bytes.length)
  w.buf.set(bytes, w.pos)
  w.pos += bytes.length
}

// A head with the shortest argument, for a length or tag below 2^32
const writeHead = (w: Writer, major: number, n: number): void => {
  reserve(w, 5)
  const mt = major << 5
  const buf = w.buf
  if (n < 24) {
    buf[w.pos++] = mt | n
  } else if (n < 0x100) {
    buf[w.pos++] = mt | 24
    buf[w.pos++] = n
  } else if (n < 0x10000) {
    buf[w.pos++] = mt | 25
    buf[w.pos++] = n >>> 8
    buf[w.pos++] = n & 0xff
  } else {
    buf[w.pos++] = mt | 26
    buf[w.pos++] = n >>> 24
    buf[w.pos++] = (n >>> 16) & 0xff
    buf[w.pos++] = (n >>> 8) & 0xff
    buf[w.pos++] = n & 0xff
  }
}

// An integer head for 0 <= n <= 2^64 - 1. Without minimal encoding, an
// argument of 24 or more takes the 8-byte form, as the CBOR encoder writes it
const writeIntHead = (w: Writer, major: number, n: bigint, minimal: boolean): void => {
  if (n < 0x100000000n && (minimal || n < 24n)) {
    writeHead(w, major, Number(n))
    return
  }
  reserve(w, 9)
  const buf = w.buf
  const high = Number(n >> 32n)
  const low = Number(n & 0xffffffffn)
  buf[w.pos++] = (major << 5) | 27
  buf[w.pos++] = high >>> 24
  buf[w.pos++] = (high >>> 16) & 0xff
  buf[w.pos++] = (high >>> 8) & 0xff
  buf[w.pos++] = high & 0xff
  buf[w.pos++] = low >>> 24
  buf[w.pos++] = (low >>> 16) & 0xff
  buf[w.pos++] = (low >>> 8) & 0xff
  buf[w.pos++] = low & 0xff
}

// A byte string of at most 64 bytes is written definite. A longer one is
// written indefinite, in 64-byte chunks
const writeBoundedBytes = (w: Writer, bytes: Uint8Array): void => {
  const length = bytes.length
  if (length <= BYTES_CHUNK_SIZE) {
    writeHead(w, 2, length)
    writeBytes(w, bytes)
    return
  }
  writeByte(w, 0x5f)
  for (let offset = 0; offset < length; offset += BYTES_CHUNK_SIZE) {
    const end = Math.min(offset + BYTES_CHUNK_SIZE, length)
    writeHead(w, 2, end - offset)
    writeBytes(w, bytes.subarray(offset, end))
  }
  writeByte(w, 0xff)
}

// The big-endian bytes of a positive integer, with no leading zero byte
const toBigEndian = (n: bigint): Uint8Array => {
  const hex = n.toString(16)
  const offset = hex.length & 1
  const bytes = new Uint8Array((hex.length + offset) >> 1)
  bytes[0] = parseInt(hex.slice(0, 2 - offset), 16)
  for (let i = 1; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(2 * i - offset, 2 * i + 2 - offset), 16)
  }
  return bytes
}

// An integer from -2^64 to 2^64 - 1 is a CBOR integer. Outside that range it
// is a bignum, tag 2 or 3, whose bytes follow the byte string rule
const writeInt = (w: Writer, layout: Layout, value: bigint): void => {
  const major = value < 0n ? 1 : 0
  const n = value < 0n ? -1n - value : value
  if (n <= MAX_UINT64) {
    writeIntHead(w, major, n, layout.minimal)
    return
  }
  writeByte(w, 0xc2 + major)
  writeBoundedBytes(w, toBigEndian(n))
}

const writeList = (w: Writer, layout: Layout, items: ReadonlyArray<Data>): void => {
  const length = items.length
  if (length === 0) {
    writeByte(w, 0x80)
    return
  }
  if (layout.indefiniteArrays) writeByte(w, 0x9f)
  else writeHead(w, 4, length)
  for (let i = 0; i < length; i++) writeData(w, layout, items[i])
  if (layout.indefiniteArrays) writeByte(w, 0xff)
}

// Shorter encoded keys first, then bytewise, as the CBOR encoder sorts map keys
const compareEncodedKeys = (a: readonly [Uint8Array, Uint8Array], b: readonly [Uint8Array, Uint8Array]): number => {
  const x = a[0]
  const y = b[0]
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return x[i] - y[i]
  }
  return 0
}

const writeMap = (w: Writer, layout: Layout, map: globalThis.Map<Data, Data>): void => {
  const size = map.size
  if (layout.mapsAsPairs) {
    if (size === 0) {
      writeByte(w, 0x80)
      return
    }
    if (layout.indefiniteArrays) writeByte(w, 0x9f)
    else writeHead(w, 4, size)
    for (const [key, value] of map) {
      writeByte(w, layout.indefiniteArrays ? 0x9f : 0x82)
      writeData(w, layout, key)
      writeData(w, layout, value)
      if (layout.indefiniteArrays) writeByte(w, 0xff)
    }
    if (layout.indefiniteArrays) writeByte(w, 0xff)
    return
  }
  if (size === 0) {
    writeByte(w, 0xa0)
    return
  }
  if (layout.indefiniteMaps) writeByte(w, 0xbf)
  else if (size < 24 || layout.minimal) writeHead(w, 5, size)
  else throw new CBOR.CBORError({ message: `Map too long: ${size} entries` })
  if (layout.sortMapKeys) {
    const entries = Array.from(map, ([key, value]) => [encodeData(key, layout), encodeData(value, layout)] as const)
    entries.sort(compareEncodedKeys)
    for (const [key, value] of entries) {
      writeBytes(w, key)
      writeBytes(w, value)
    }
  } else {
    for (const [key, value] of map) {
      writeData(w, layout, key)
      writeData(w, layout, value)
    }
  }
  if (layout.indefiniteMaps) writeByte(w, 0xff)
}

/**
 * A tag head, at the width `CBOR` writes it at.
 *
 * ⚠️ Every constructor tag is 24 or more — 102, 121 to 127, 1280 to 1400 — and a non-minimal
 * option set used to refuse all of them here, on the grounds that the encoder could not write a
 * wide tag. It can: a tag of 24 or more goes out in the four-byte `0xda` form when minimal
 * encoding is off, which is what the tree encoder produces for the same value. Refusing instead
 * made a legal datum unencodable under one of this package's own presets.
 */
const writeTagHead = (w: Writer, tag: number, minimal: boolean): void => {
  if (tag < 24) {
    writeByte(w, 0xc0 + tag)
    return
  }
  if (minimal) {
    writeHead(w, 6, tag)
    return
  }
  reserve(w, 5)
  writeByte(w, 0xda)
  writeByte(w, (tag >>> 24) & 0xff)
  writeByte(w, (tag >>> 16) & 0xff)
  writeByte(w, (tag >>> 8) & 0xff)
  writeByte(w, tag & 0xff)
}

// Indices 0 to 6 are tags 121 to 127, indices 7 to 127 are tags 1280 to 1400,
// and any other index is tag 102 over the definite pair [index, fields]
const writeConstr = (w: Writer, layout: Layout, constr: Constr): void => {
  const index = constr.index
  if (index < 0n || index > MAX_UINT64) {
    throw new DataError({ message: `Constructor index out of range: ${index}` })
  }
  const tag = index <= 6n ? 121 + Number(index) : index <= 127n ? 1280 + Number(index) - 7 : 102
  writeTagHead(w, tag, layout.minimal)
  if (tag === 102) {
    writeByte(w, 0x82)
    writeIntHead(w, 0, index, true)
  }
  writeList(w, layout, constr.fields)
}

const writeData = (w: Writer, layout: Layout, data: Data): void => {
  // Checked at EVERY node, not only the root: a list assembled from decoded children writes each
  // child as it arrived while the list itself takes this layout, which is what a caller splicing
  // encoded children needs. A `bigint` cannot carry a record (it is not an object), so a
  // non-minimal integer header is the one arrival detail lost, and only where the integer is the
  // root — nested, its container replays it.
  if (layout.keepArrival && typeof data === "object" && data !== null) {
    const arrived = OriginalBytes.get(data)
    if (arrived !== undefined) {
      writeBytes(w, arrived)
      return
    }
  }
  if (typeof data === "bigint") writeInt(w, layout, data)
  else if (data instanceof Uint8Array) writeBoundedBytes(w, data)
  else if (Array.isArray(data)) writeList(w, layout, data)
  else if (data instanceof globalThis.Map) writeMap(w, layout, data)
  else if (data instanceof Constr || isConstr(data)) writeConstr(w, layout, data)
  else throw new DataError({ message: `Unsupported PlutusData type: ${String(data)}` })
}

const encodeData = (data: Data, layout: Layout): Uint8Array => {
  const w: Writer = { buf: new Uint8Array(256), pos: 0 }
  writeData(w, layout, data)
  return w.buf.slice(0, w.pos)
}

// ============================================================================
// Combinators
// ============================================================================

/**
 * Convert PlutusData to CBORValue
 *
 * @since 2.0.0
 * @category transformation
 */
export const plutusDataToCBORValue = (data: Data, options?: CBOR.CodecOptions): CBOR.CBOR => {
  // Arrival bytes win over any representation this function would choose. Checked at every node,
  // so a list assembled from decoded children re-encodes each child as it arrived while the list
  // itself gets the default framing -- which is the whole of what a caller splicing hex by hand
  // used to do. `bigint` cannot carry a record (it is not an object), so a non-minimal integer
  // header is the one arrival detail lost, and only where the integer is the ROOT: nested, its
  // container replays it. See {@link fromCBORBytes}.
  //
  // ⚠️ `mode: "canonical"` is the one request that outranks provenance, because canonicalising IS
  // choosing a new representation -- a caller passing it has asked for the normalised form and
  // accepts the different hash that comes with it. Every other option set describes a house style
  // for values this encoder is choosing bytes for, and says nothing about bytes already chosen.
  const keepArrival = options === undefined || options.mode !== "canonical"
  const recurse = (child: Data): CBOR.CBOR => plutusDataToCBORValue(child, options)
  if (keepArrival && typeof data === "object" && data !== null) {
    const arrived = OriginalBytes.get(data)
    if (arrived !== undefined) return CBOR.Raw.make(arrived)
  }
  return matchData(data, {
    Map: (entries): CBOR.CBOR => {
      // PlutusData Map -> CBOR map directly (no extra tag needed for top-level maps)
      const cborEntries = entries.map(([key, value]) => [recurse(key), recurse(value)] as const)
      return new Map(cborEntries)
    },
    List: (items): CBOR.CBOR => {
      // PlutusData List -> CBOR array directly (no extra tag needed for top-level arrays)
      const cborItems = items.map(recurse)
      return cborItems
    },
    Int: (value): CBOR.CBOR => {
      // PlutusData Int -> CBOR uint or nint
      return value
    },
    Bytes: (bytes): CBOR.CBOR => {
      // Conway CDDL: bounded_bytes = bytes .size (0..64)
      // BoundedBytes enforces the chunking rule at the CBOR node level,
      // independent of codec options. See CBOR.BoundedBytes.
      return CBOR.BoundedBytes.make(bytes)
    },
    Constr: (constr): CBOR.CBOR => {
      // PlutusData Constr -> CBOR tags based on index
      const cborFields = constr.fields.map(recurse)
      const fieldsArray = cborFields

      if (constr.index >= 0n && constr.index <= 6n) {
        // Direct encoding for constructor indices 0-6 (tags 121-127)
        return CBOR.Tag.make({
          tag: Number(121n + constr.index),
          value: fieldsArray
        })
      } else if (constr.index >= 7n && constr.index <= 127n) {
        // Alternative encoding for constructor indices 7-127 (tag 1280+index-7)
        return CBOR.Tag.make({
          tag: Number(1280n + constr.index - 7n),
          value: fieldsArray
        })
      } else {
        // General constructor encoding for any uint value (tag 102)
        return CBOR.Tag.make({
          tag: 102,
          // ⚠️ DEFINITE, while the fields array inside it stays indefinite. CSL 15.0.3 and CML 6.2
          // both write `d866 82 …` here; an indefinite wrapper is this library alone. Pinned on the
          // node because one codec option cannot say both.
          value: CBOR.DefiniteArray.make([constr.index, fieldsArray])
        })
      }
    }
  })
}

/**
 * Convert CBORValue to PlutusData
 *
 * @since 2.0.0
 * @category transformation
 */
export const cborValueToPlutusData = (cborValue: CBOR.CBOR, fmt?: CBOR.CBORFormat): Data => {
  // Hold onto the bytes this node arrived as, so re-encoding it is a copy rather than a fresh
  // decision. Only reachable when a `fmt` was threaded in -- without one there is nothing to
  // replay and the node encodes structurally, which is the behaviour every caller had before.
  const keep = <A extends Data>(data: A): A => {
    if (fmt === undefined || typeof data !== "object" || data === null) return data
    return OriginalBytes.record(data, CBOR.toCBORBytesWithFormat(cborValue, fmt))
  }
  const childFmt = (index: number): CBOR.CBORFormat | undefined =>
    fmt?._tag === "array" ? fmt.children[index] : undefined
  const taggedChildFmt = (): CBOR.CBORFormat | undefined => (fmt?._tag === "tag" ? fmt.child : undefined)

  // Handle bigint (uint/nint)
  if (CBOR.isInteger(cborValue)) {
    return cborValue
  }

  // Handle Uint8Array (bytes)
  if (CBOR.isByteArray(cborValue)) {
    return keep(cborValue)
  }

  // Handle tagged values
  if (CBOR.isTag(cborValue)) {
    const tag = cborValue.tag
    const value = cborValue.value

    // Handle constructor tags (121-127 for indices 0-6)
    if (tag >= 121 && tag <= 127) {
      if (!Array.isArray(value)) {
        throw new DataError({
          message: `Expected array for constructor tag ${tag}, got ${typeof value}`
        })
      }
      const inner = taggedChildFmt()
      const fieldFmt = (i: number) => (inner?._tag === "array" ? inner.children[i] : undefined)
      const fields = value.map((field, i) => cborValueToPlutusData(field, fieldFmt(i)))
      return keep(new Constr({ index: Numeric.Uint64Make(BigInt(tag - 121)), fields }))
    }

    // Handle alternative constructor tags (1280-1400 for indices 7-127)
    if (tag >= 1280 && tag <= 1400) {
      if (!Array.isArray(value)) {
        throw new DataError({
          message: `Expected array for constructor tag ${tag}, got ${typeof value}`
        })
      }
      const inner = taggedChildFmt()
      const fieldFmt = (i: number) => (inner?._tag === "array" ? inner.children[i] : undefined)
      const fields = value.map((field, i) => cborValueToPlutusData(field, fieldFmt(i)))
      return keep(new Constr({ index: Numeric.Uint64Make(BigInt(tag - 1280 + 7)), fields }))
    }

    // Handle general constructor tag (102)
    if (tag === 102) {
      if (!Array.isArray(value)) {
        throw new DataError({
          message: `Expected array for general constructor tag, got ${typeof value}`
        })
      }

      const array = value
      if (array.length === 2) {
        // Two element arrays are general constructors [index, fields]
        const indexValue = array[0]
        const fieldsValue = array[1]

        if (typeof indexValue !== "bigint") {
          throw new DataError({
            message: `Expected bigint for constructor index, got ${typeof indexValue}`
          })
        }
        if (!Array.isArray(fieldsValue)) {
          throw new DataError({
            message: `Expected array for constructor fields, got ${typeof fieldsValue}`
          })
        }

        const wrapper = taggedChildFmt()
        const listFmt = wrapper?._tag === "array" ? wrapper.children[1] : undefined
        const fieldFmt = (i: number) => (listFmt?._tag === "array" ? listFmt.children[i] : undefined)
        const fields = fieldsValue.map((field, i) => cborValueToPlutusData(field, fieldFmt(i)))
        return keep(new Constr({ index: Numeric.Uint64Make(indexValue), fields }))
      }
    }

    // Handle big_uint tag (2) for large positive integers
    if (tag === 2) {
      if (!(value instanceof Uint8Array)) {
        throw new DataError({
          message: `Expected bytes for big_uint tag, got ${typeof value}`
        })
      }
      // Convert bytes to bigint (big-endian)
      return bytesToBigint(value)
    }

    // Handle big_nint tag (3) for large negative integers
    if (tag === 3) {
      if (!(value instanceof Uint8Array)) {
        throw new DataError({
          message: `Expected bytes for big_nint tag, got ${typeof value}`
        })
      }
      // Convert bytes to bigint and negate (add 1) per RFC 8949
      const positiveValue = bytesToBigint(value)
      return -(positiveValue + 1n)
    }

    throw new DataError({ message: `Unsupported CBOR tag: ${tag}` })
  }

  // Handle arrays
  if (CBOR.isArray(cborValue)) {
    // Arrays are Lists
    const items = cborValue.map((item, i) => cborValueToPlutusData(item, childFmt(i)))
    return keep(items)
  }

  // Handle Maps
  if (CBOR.isMap(cborValue)) {
    // Maps are Maps
    const entryFmt = (i: number): readonly [CBOR.CBORFormat | undefined, CBOR.CBORFormat | undefined] => {
      const pair = fmt?._tag === "map" ? fmt.entries[i] : undefined
      return pair === undefined ? [undefined, undefined] : pair
    }
    const entries = Array.from(cborValue.entries()).map(([k, v], i) => {
      const [kf, vf] = entryFmt(i)
      return [cborValueToPlutusData(k, kf), cborValueToPlutusData(v, vf)] as const
    })
    return keep(new Map(entries))
  }

  // Handle unsupported types
  throw new DataError({
    message: `Unknown CBOR value type: ${JSON.stringify(cborValue)}`
  })
}

// ============================================================================
// Byte-level assembly, for a caller that already holds encoded children
// ============================================================================

/**
 * Assemble `plutus_data` from children that are ALREADY encoded, splicing their bytes.
 *
 * ⚠️ **Why this exists next to the typed constructors.** {@link fromCBORBytes} records the bytes
 * every node arrived as and {@link toCBORBytes} replays them, so decoding a child and rebuilding
 * around it is lossless for anything that can carry a record. One thing cannot: a `bigint` is not
 * an object, so a non-minimally encoded integer (`19002a` for 42, which the ledger accepts and
 * nothing here writes) has nowhere to keep its header width. A caller holding encoded children
 * therefore has a choice between decoding them -- correct except for that integer -- and splicing
 * them, which is correct for everything. These splice.
 *
 * Use the typed constructors ({@link list}, {@link constr}, {@link map}) when the children are
 * values this process produced. Use these when the children came off a wire and are going back on
 * one unchanged, which is every datum nested inside another datum.
 *
 * The framing matches what the typed encoder writes under the Plutus data options, so the two
 * routes agree for any child that round-trips: non-empty lists and constructor fields are
 * indefinite, the empty list is definite, the tag-102 wrapper is definite, and a Plutus map is
 * definite and keeps the order it was given.
 *
 * @since 2.8.0
 * @category encoding
 */
export const spliceList = (items: ReadonlyArray<Uint8Array>): Uint8Array =>
  items.length === 0 ? CBOR.encodeArrayAsDefinite([]) : CBOR.encodeArrayAsIndefinite(items)

/**
 * A `Constr` over already-encoded fields, in the three tag ranges the Plutus encoding defines.
 *
 * ⚠️ The tag-102 wrapper `[index, fields]` is DEFINITE while the fields array inside it stays
 * indefinite. `cardano-serialization-lib` 15.0.3 and `cardano-multiplatform-lib` 6.2 both write
 * `d866 82 …`; no single codec option can say both, which is why the shape is written here.
 *
 * See {@link spliceList} for when to reach for this rather than {@link constr}.
 *
 * @since 2.8.0
 * @category encoding
 */
export const spliceConstr = (index: bigint, fieldItems: ReadonlyArray<Uint8Array>): Uint8Array => {
  const fields = spliceList(fieldItems)
  if (index >= 0n && index <= 6n) return CBOR.encodeTaggedValue(Number(121n + index), fields)
  if (index >= 7n && index <= 127n) return CBOR.encodeTaggedValue(Number(1280n + index - 7n), fields)
  return CBOR.encodeTaggedValue(102, CBOR.encodeArrayAsDefinite([CBOR.toCBORBytes(index), fields]))
}

/**
 * A Plutus map over already-encoded keys and values.
 *
 * ⚠️ Definite-framed, and the entries keep the order given: a Plutus map is NOT sorted. Sorting
 * it is a different value as far as a script reading it by position is concerned, and a different
 * hash either way.
 *
 * See {@link spliceList} for when to reach for this rather than {@link map}.
 *
 * @since 2.8.0
 * @category encoding
 */
export const spliceMap = (entries: ReadonlyArray<readonly [Uint8Array, Uint8Array]>): Uint8Array =>
  CBOR.encodeMapAsDefinite(entries)

/**
 * Deep structural hash for Plutus Data values.
 * Handles maps, lists, ints, bytes, and constrs.
 *
 * @since 2.0.0
 * @category equality
 */
export const hash = (data: Data): number => {
  if (typeof data === "bigint") return Hash.hash(data)
  if (typeof data === "string") return Hash.string(data)

  // Arrays (Lists)
  if (Array.isArray(data)) {
    let h = Hash.hash(data.length)
    for (const item of data) {
      h ^= hash(item)
    }
    return h
  }

  // Constr
  if (data instanceof Constr) {
    let h = Hash.hash(data.index)
    for (const field of data.fields) {
      h ^= hash(field as Data)
    }
    return h
  }

  // Map
  if (data instanceof Map) {
    let h = Hash.hash(data.size)
    for (const [key, value] of data.entries()) {
      h ^= hash(key as Data) ^ hash(value as Data)
    }
    return h
  }

  return 0
}

/**
 * Schema-derived structural equality for Plutus Data values.
 * Handles maps, lists, ints, bytes, and constrs via the
 * recursive DataSchema definition — no hand-rolled comparison needed.
 *
 * @since 2.0.0
 * @category equality
 */
export const equals: (a: Data, b: Data) => boolean = Schema.equivalence(DataSchema)

export const CDDLSchema = CBOR.CBORSchema

/**
 * CDDL schema for PlutusData following the Conway specification.
 *
 * ```
 * plutus_data =
 *   constr<plutus_data>
 *   / {* plutus_data => plutus_data}
 *   / [* plutus_data]
 *   / big_int
 *   / bounded_bytes
 *
 * constr<a0> =
 *   #6.121([* a0])    // index 0
 *   / #6.122([* a0])  // index 1
 *   / #6.123([* a0])  // index 2
 *   / #6.124([* a0])  // index 3
 *   / #6.125([* a0])  // index 4
 *   / #6.126([* a0])  // index 5
 *   / #6.127([* a0])  // index 6
 *   / #6.102([uint, [* a0]])  // general constructor
 *
 * big_int = int / big_uint / big_nint
 * big_uint = #6.2(bounded_bytes)
 * big_nint = #6.3(bounded_bytes)
 * ```
 *
 * This transforms between CBOR values and PlutusData using the existing
 * plutusDataToCBORValue and cborValueToPlutusData functions.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCDDL = Schema.transformOrFail(CDDLSchema, Schema.typeSchema(DataSchema), {
  strict: true,
  encode: (_, __, ___, data) => Effect.succeed(plutusDataToCBORValue(data)),
  decode: (_, __, ___, cborValue) =>
    Effect.try({
      try: () => cborValueToPlutusData(cborValue),
      catch: (error) => new ParseResult.Type(DataSchema.ast, cborValue, String(error))
    })
})

/**
 * `FromCDDL` for a known option set, so the provenance rule in {@link plutusDataToCBORValue} can
 * see which options the caller chose.
 *
 * ⚠️ Separate from {@link FromCDDL} rather than replacing it: the plain schema is composed into
 * {@link FromCBORBytes}, whose own CBOR layer already carries the options, and a schema cannot be
 * told at encode time what its caller passed.
 *
 * @since 2.8.0
 * @category schemas
 */
/**
 * CBOR bytes transformation schema for PlutusData using CDDL.
 * Decodes through {@link FromCDDL}. Encodes as {@link toCBORBytes} does.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = (options: CBOR.CodecOptions = DEFAULT_CBOR_OPTIONS) => {
  const fromBytes = Schema.compose(CBOR.FromBytes(options), FromCDDL)
  const layout = toLayout(options)
  return Schema.transformOrFail(Schema.Uint8ArrayFromSelf, Schema.typeSchema(DataSchema), {
    strict: true,
    decode: (bytes, parseOptions) => ParseResult.decode(fromBytes)(bytes, parseOptions),
    encode: (data, _, ast) =>
      ParseResult.try({
        try: () => encodeData(data, layout),
        catch: (error) =>
          new ParseResult.Type(
            ast,
            data,
            `Failed to encode CBOR value: ${error instanceof Error ? error.message : String(error)}`
          )
      })
  }).annotations({
    identifier: "Data.FromCBORBytes",
    title: "Data from CBOR Bytes using CDDL",
    description: "Transforms CBOR bytes to Data using CDDL encoding"
  })
}

/**
 * CBOR hex transformation schema for PlutusData using CDDL.
 * Transforms between CBOR hex string and Data using CDDL encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = (options: CBOR.CodecOptions = DEFAULT_CBOR_OPTIONS) =>
  Schema.compose(
    Schema.Uint8ArrayFromHex, // string → Uint8Array
    FromCBORBytes(options) // Uint8Array → Data
  ).annotations({
    identifier: "Data.FromCBORHex",
    title: "Data from CBOR Hex using CDDL",
    description: "Transforms CBOR hex string to Data using CDDL encoding"
  })

/**
 * Encode PlutusData to CBOR bytes.
 *
 * `options` choose definite or indefinite lists and maps, map key order and
 * integer widths. These rules hold under every option:
 *
 * - A byte string over 64 bytes is written indefinite, in 64-byte chunks.
 * - An integer from -2^64 to 2^64 - 1 is a CBOR integer. Outside that range it
 *   is a bignum (tag 2 or 3) whose bytes follow the byte string rule.
 * - A constructor index above 127 is tag 102 over a definite pair
 *   `[index, fields]`; only the fields follow `options`.
 *
 * @since 2.0.0
 * @category transformation
 */
export const toCBORBytes = (data: Data, options: CBOR.CodecOptions = DEFAULT_CBOR_OPTIONS): Uint8Array =>
  encodeData(data, toLayout(options))

/**
 * A `plutus_data` item as CBOR hex.
 *
 * ⚠️ A script consumer matches a datum by its hash, so these bytes are the value: a re-encoding
 * that differs by one byte hashes differently.
 *
 * Branded so that CBOR hex of one kind cannot stand in for another once it leaves the typed
 * domain. Non-empty whole bytes is all the shape there is to check.
 *
 * @since 2.4.0
 * @category schemas
 */
export const Hex = Schema.String.pipe(Schema.pattern(/^([0-9a-fA-F]{2})+$/), Schema.brand("PlutusDataHex"))

/**
 * @since 2.4.0
 * @category model
 */
export type Hex = typeof Hex.Type

/**
 * Encode PlutusData to CBOR hex string, as {@link toCBORBytes} writes it.
 *
 * @since 2.0.0
 * @category transformation
 */
export const toCBORHex = (data: Data, options: CBOR.CodecOptions = DEFAULT_CBOR_OPTIONS): string =>
  Bytes.toHex(toCBORBytes(data, options))

/**
 * Decode PlutusData from CBOR bytes
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromCBORBytes = (bytes: Uint8Array, options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS): Data => {
  // Decoded WITH its format tree, so every node remembers the bytes it arrived as and
  // `toCBORBytes` hands them back instead of choosing a representation again. The ledger hashes
  // what arrived: `9fff` and `80` are the same `[]` and different `script_data_hash`es.
  //
  // `options` is accepted for symmetry with the schema form and has no effect on this path --
  // decoding is options-independent apart from `mapsAsObjects`, which `Data` has never supported
  // (a Record has no branch in `cborValueToPlutusData`).
  void options
  const decoded = CBOR.fromCBORBytesWithFormat(bytes)
  return cborValueToPlutusData(decoded.value, decoded.format)
}

/**
 * Decode PlutusData from CBOR hex string
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromCBORHex = (hex: string, options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS): Data =>
  fromCBORBytes(Bytes.fromHex(hex), options)

/**
 * Create a schema that transforms from a custom type to Data and provides CBOR encoding
 *
 * @since 2.0.0
 * @category combinators
 */
export const withSchema = <A, I extends Data>(
  schema: Schema.Schema<A, I>,
  options: CBOR.CodecOptions = DEFAULT_CBOR_OPTIONS
) => {
  return {
    toData: Schema.encodeSync(schema),
    fromData: Schema.decodeSync(schema),
    toCBORHex: Schema.encodeSync(Schema.compose(FromCBORHex(options), schema)),
    toCBORBytes: Schema.encodeSync(Schema.compose(FromCBORBytes(options), schema)),
    fromCBORHex: Schema.decodeSync(Schema.compose(FromCBORHex(options), schema)),
    fromCBORBytes: Schema.decodeSync(Schema.compose(FromCBORBytes(options), schema))
  }
}

/**
 * Compute the hash of PlutusData using blake2b-256 over its CBOR encoding.
 * Defaults to PLUTUS_DATA_OPTIONS, the node layout.
 *
 * @since 2.0.0
 * @category hashing
 * @example
 * ```typescript
 * import * as Data from "@evolution-sdk/evolution/Data"
 *
 * // Hash a simple integer
 * const intData = 42n
 * const intHash = Data.toDatumHash(intData)
 *
 * // Hash a constructor
 * const constr = new Data.Constr({ index: 0n, fields: [1n, 2n] })
 * const constrHash = Data.toDatumHash(constr)
 *
 * // Hash a bytearray
 * const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
 * const bytesHash = Data.toDatumHash(bytes)
 * ```
 */
export const toDatumHash = (
  data: Data,
  options: CBOR.CodecOptions = DEFAULT_CBOR_OPTIONS
): DatumHash.DatumHash => {
  const bytes = toCBORBytes(data, options)
  const digest = blake2b(bytes, { dkLen: 32 })
  return new DatumHash.DatumHash({ hash: digest })
}

/**
 * @since 2.0.0
 * @category hashing
 * @deprecated Use `toDatumHash` instead.
 */
export const hashData = toDatumHash
