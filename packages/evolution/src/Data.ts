import { blake2b } from "@noble/hashes/blake2"
import { Data as EffectData, Equal, FastCheck, Hash, ParseResult, Schema } from "effect"

import * as CBOR from "./CBOR.js"
import * as DatumHash from "./DatumHash.js"
import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter } from "./v2/CborWriter.js"

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
 * Default CBOR options for Data encoding/decoding
 *
 * @since 2.0.0
 * @category constants
 */
export const DEFAULT_CBOR_OPTIONS = CBOR.CML_DATA_DEFAULT_OPTIONS

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
// Combinators
// ============================================================================

/**
 * Convert PlutusData to CBORValue
 *
 * @since 2.0.0
 * @category transformation
 */
export const plutusDataToCBORValue = (data: Data): CBOR.CBOR => {
  return matchData(data, {
    Map: (entries): CBOR.CBOR => {
      // PlutusData Map -> CBOR map directly (no extra tag needed for top-level maps)
      const cborEntries = entries.map(
        ([key, value]) => [plutusDataToCBORValue(key), plutusDataToCBORValue(value)] as const
      )
      return new Map(cborEntries)
    },
    List: (items): CBOR.CBOR => {
      // PlutusData List -> CBOR array directly (no extra tag needed for top-level arrays)
      const cborItems = items.map(plutusDataToCBORValue)
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
      const cborFields = constr.fields.map(plutusDataToCBORValue)
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
          value: [constr.index, fieldsArray]
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
export const cborValueToPlutusData = (cborValue: CBOR.CBOR): Data => {
  // Handle bigint (uint/nint)
  if (CBOR.isInteger(cborValue)) {
    return cborValue
  }

  // Handle Uint8Array (bytes)
  if (CBOR.isByteArray(cborValue)) {
    return cborValue
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
      const fields = value.map(cborValueToPlutusData)
      return new Constr({ index: Numeric.Uint64Make(BigInt(tag - 121)), fields })
    }

    // Handle alternative constructor tags (1280-1400 for indices 7-127)
    if (tag >= 1280 && tag <= 1400) {
      if (!Array.isArray(value)) {
        throw new DataError({
          message: `Expected array for constructor tag ${tag}, got ${typeof value}`
        })
      }
      const fields = value.map(cborValueToPlutusData)
      return new Constr({ index: Numeric.Uint64Make(BigInt(tag - 1280 + 7)), fields })
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

        const fields = fieldsValue.map(cborValueToPlutusData)
        return new Constr({ index: Numeric.Uint64Make(indexValue), fields })
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
    const items = cborValue.map(cborValueToPlutusData)
    return items
  }

  // Handle Maps
  if (CBOR.isMap(cborValue)) {
    // Maps are Maps
    const entries = Array.from(cborValue.entries()).map(
      ([k, v]) => [cborValueToPlutusData(k), cborValueToPlutusData(v)] as const
    )
    return new Map(entries)
  }

  // Handle unsupported types
  throw new DataError({
    message: `Unknown CBOR value type: ${JSON.stringify(cborValue)}`
  })
}

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


// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

/** Encode a PlutusData key to bytes for canonical sorting */
const encodeKey = (key: Data, options: CBOR.CodecOptions): Uint8Array => {
  const kw = new CborWriter(64)
  write(kw, key, options)
  return kw.finishView()
}

/** BoundedBytes chunk size per Conway CDDL: bounded_bytes = bytes .size (0..64) */
const BOUNDED_BYTES_CHUNK = 64

/**
 * Write a BoundedBytes value — bytes ≤ 64 as definite, > 64 as indefinite 64-byte chunks.
 */
/** Encode bounded bytes to raw CBOR bytes */
const encodeBoundedBytes = (value: Uint8Array): Uint8Array => {
  if (value.length <= BOUNDED_BYTES_CHUNK) {
    // Definite byte string
    const w = new CborWriter(value.length + 3)
    w.writeBytes(value)
    return w.finishView()
  }
  // Indefinite: 0x5f + chunks + 0xff
  const numChunks = Math.ceil(value.length / BOUNDED_BYTES_CHUNK)
  // Each chunk has a 1-2 byte header + data. Max total: 1 + numChunks*(2+64) + 1
  const result = new CborWriter(2 + numChunks * (BOUNDED_BYTES_CHUNK + 3))
  result.writeRaw(new Uint8Array([0x5f])) // indefinite byte string
  let offset = 0
  while (offset < value.length) {
    const chunkLen = Math.min(BOUNDED_BYTES_CHUNK, value.length - offset)
    result.writeBytes(value.subarray(offset, offset + chunkLen))
    offset += chunkLen
  }
  result.writeBreak() // 0xff
  return result.finishView()
}

/**
 * Write PlutusData directly to CborWriter. No CBOR value tree intermediate.
 *
 * Encoding rules:
 * - Integer: uint (≥0) or nint (<0), big_uint (tag 2) / big_nint (tag 3) for large values
 * - Bytes: BoundedBytes — ≤64 definite, >64 indefinite 64-byte chunks
 * - List: indefinite array (Plutus default) or definite (CML default)
 * - Map: indefinite map (Plutus default) or definite (CML default)
 * - Constr 0-6: tag 121-127 + array of fields
 * - Constr 7-127: tag 1280+(index-7) + array of fields
 * - Constr ≥128: tag 102 + [index, fields]
 */
export const write = (w: CborWriter, v: Data, options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS): void => {
  const isCanonical = options.mode === "canonical"
  const useIndef = options.mode === "custom" && options.useIndefiniteArrays
  const mapAsPairs = options.mode === "custom" && options.encodeMapAsPairs === true
  const sortKeys = isCanonical || (options.mode === "custom" && options.sortMapKeys)

  matchData(v, {
    Int: (value) => {
      if (value >= 0n) {
        if (value < 0x10000000000000000n) {
          w.writeUint(value)
        } else {
          // big_uint: tag(2) + bytes (big-endian)
          w.writeTagHeader(2)
          w.writeRaw(encodeBoundedBytes(bigintToBytes(value)))
        }
      } else {
        const pv = -value - 1n
        if (pv < 0x10000000000000000n) {
          w.writeNint(value)
        } else {
          // big_nint: tag(3) + bytes (big-endian of -1-n)
          w.writeTagHeader(3)
          w.writeRaw(encodeBoundedBytes(bigintToBytes(pv)))
        }
      }
    },
    Bytes: (bytes) => {
      w.writeRaw(encodeBoundedBytes(bytes))
    },
    List: (items) => {
      const empty = items.length === 0
      if (useIndef && !empty) {
        w.writeIndefiniteArrayHeader()
        for (const item of items) write(w, item, options)
        w.writeBreak()
      } else {
        w.writeDefiniteArrayHeader(items.length)
        for (const item of items) write(w, item, options)
      }
    },
    Map: (entries) => {
      // Sort entries by canonical CBOR key order if requested
      const sorted = sortKeys ? [...entries].sort((a, b) => {
        const ka = encodeKey(a[0], options)
        const kb = encodeKey(b[0], options)
        if (ka.length !== kb.length) return ka.length - kb.length
        for (let i = 0; i < ka.length; i++) { if (ka[i] !== kb[i]) return ka[i] - kb[i] }
        return 0
      }) : entries

      if (mapAsPairs) {
        const empty = sorted.length === 0
        if (useIndef && !empty) {
          w.writeIndefiniteArrayHeader()
          for (const [k, val] of sorted) {
            w.writeIndefiniteArrayHeader()
            write(w, k, options); write(w, val, options)
            w.writeBreak()
          }
          w.writeBreak()
        } else {
          w.writeDefiniteArrayHeader(sorted.length)
          for (const [k, val] of sorted) {
            w.writeDefiniteArrayHeader(2)
            write(w, k, options); write(w, val, options)
          }
        }
      } else {
        const empty = sorted.length === 0
        if (useIndef && !empty) {
          w.writeIndefiniteMapHeader()
          for (const [k, val] of sorted) { write(w, k, options); write(w, val, options) }
          w.writeBreak()
        } else {
          w.writeDefiniteMapHeader(sorted.length)
          for (const [k, val] of sorted) { write(w, k, options); write(w, val, options) }
        }
      }
    },
    Constr: (constr) => {
      if (constr.index >= 0n && constr.index <= 6n) {
        w.writeTagHeader(Number(121n + constr.index))
      } else if (constr.index >= 7n && constr.index <= 127n) {
        w.writeTagHeader(Number(1280n + constr.index - 7n))
      } else {
        w.writeTagHeader(102)
        if (useIndef) {
          w.writeIndefiniteArrayHeader()
          w.writeUint(constr.index)
        } else {
          w.writeDefiniteArrayHeader(2)
          w.writeUint(constr.index)
        }
      }
      // Fields array
      if (useIndef && constr.fields.length > 0) {
        w.writeIndefiniteArrayHeader()
        for (const field of constr.fields) write(w, field, options)
        w.writeBreak()
      } else {
        w.writeDefiniteArrayHeader(constr.fields.length)
        for (const field of constr.fields) write(w, field, options)
      }
      // Close tag 102 outer array
      if (constr.index > 127n && useIndef) {
        w.writeBreak()
      }
    }
  })
}

/**
 * Read PlutusData directly from CborReader. No CBOR value tree intermediate.
 */
export const read = (r: CborReader): Data => {
  const mt = r.peekMajorType()

  switch (mt) {
    case 0: return r.readUint()    // positive integer
    case 1: return r.readNint()    // negative integer
    case 2: return readBoundedBytes(r)  // byte string (possibly indefinite/chunked)
    case 3: throw new DataError({ message: "Unexpected text string in PlutusData" })
    case 4: {
      // Array = List
      const count = r.readArrayHeader()
      const items: Array<Data> = []
      if (count === -1) { while (!r.isBreak()) items.push(read(r)) }
      else { for (let i = 0; i < count; i++) items.push(read(r)) }
      return items
    }
    case 5: {
      // Map
      const count = r.readMapHeader()
      const entries: Array<readonly [Data, Data]> = []
      if (count === -1) { while (!r.isBreak()) entries.push([read(r), read(r)] as const) }
      else { for (let i = 0; i < count; i++) entries.push([read(r), read(r)] as const) }
      return new Map(entries)
    }
    case 6: {
      // Tag — Constr or big integer
      const tag = r.readTagHeader()

      // big_uint: tag 2 + bytes
      if (tag === 2) return bytesToBigint(readBoundedBytes(r))
      // big_nint: tag 3 + bytes
      if (tag === 3) return -(bytesToBigint(readBoundedBytes(r)) + 1n)

      // Constr 0-6: tag 121-127
      if (tag >= 121 && tag <= 127) {
        const fields = readFieldsArray(r)
        return new Constr({ index: Numeric.Uint64Make(BigInt(tag - 121)), fields })
      }
      // Constr 7-127: tag 1280-1400
      if (tag >= 1280 && tag <= 1400) {
        const fields = readFieldsArray(r)
        return new Constr({ index: Numeric.Uint64Make(BigInt(tag - 1280 + 7)), fields })
      }
      // Constr general: tag 102 + [index, fields]
      if (tag === 102) {
        const outerCount = r.readArrayHeader()
        const index = r.readUint()
        const fields = readFieldsArray(r)
        if (outerCount === -1) r.isBreak()
        return new Constr({ index: Numeric.Uint64Make(index), fields })
      }
      throw new DataError({ message: `Unsupported PlutusData CBOR tag: ${tag}` })
    }
    default:
      throw new DataError({ message: `Unexpected CBOR major type ${mt} in PlutusData` })
  }
}

/** Read an array of PlutusData fields — validates major type is array (4) */
const readFieldsArray = (r: CborReader): Array<Data> => {
  const mt = r.peekMajorType()
  if (mt !== 4) throw new DataError({ message: `Expected array for Constr fields, got major type ${mt}` })
  const count = r.readArrayHeader()
  const fields: Array<Data> = []
  if (count === -1) { while (!r.isBreak()) fields.push(read(r)) }
  else { for (let i = 0; i < count; i++) fields.push(read(r)) }
  return fields
}

/** Read BoundedBytes — handles both definite and indefinite byte strings */
const readBoundedBytes = (r: CborReader): Uint8Array => {
  return r.readBytes() // CborReader already handles indefinite byte strings
}

/** Convert bigint to big-endian bytes */
const bigintToBytes = (value: bigint): Uint8Array => {
  if (value === 0n) return new Uint8Array([0])
  const hex = value.toString(16)
  const paddedHex = hex.length % 2 ? "0" + hex : hex
  const bytes = new Uint8Array(paddedHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(paddedHex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * CBOR bytes transformation schema for PlutusData using CDDL.
 * Transforms between CBOR bytes and Data using CDDL encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(DataSchema),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Data.FromCBORBytes" })

/**
 * CBOR hex transformation schema for PlutusData using CDDL.
 * Transforms between CBOR hex string and Data using CDDL encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Data.FromCBORHex" })

/**
 * Encode PlutusData to CBOR bytes
 *
 * @since 2.0.0
 * @category transformation
 */
export const toCBORBytes = (data: Data, options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS): Uint8Array => {
  const w = new CborWriter(256)
  write(w, data, options)
  return w.finishView()
}

/**
 * Encode PlutusData to CBOR hex string
 *
 * @since 2.0.0
 * @category transformation
 */
export const toCBORHex = (data: Data, options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS) =>
  Schema.encodeSync(Schema.Uint8ArrayFromHex)(toCBORBytes(data, options))

/**
 * Decode PlutusData from CBOR bytes
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Decode PlutusData from CBOR hex string
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

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
    toCBORHex: (a: A) => toCBORHex(Schema.encodeSync(schema)(a) as Data, options),
    toCBORBytes: (a: A) => toCBORBytes(Schema.encodeSync(schema)(a) as Data, options),
    fromCBORHex: (hex: string) => Schema.decodeSync(schema)(fromCBORHex(hex) as I),
    fromCBORBytes: (bytes: Uint8Array) => Schema.decodeSync(schema)(fromCBORBytes(bytes) as I)
  }
}

/**
 * Compute the hash of PlutusData using blake2b-256 over its CBOR encoding.
 * Defaults to CML_DATA_DEFAULT_OPTIONS (indefinite-length arrays/maps).
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
  options: CBOR.CodecOptions = CBOR.CML_DATA_DEFAULT_OPTIONS
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
