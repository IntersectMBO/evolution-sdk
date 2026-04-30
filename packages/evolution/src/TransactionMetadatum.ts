import { FastCheck, ParseResult, Schema } from "effect"

import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Encoded type for transaction metadata (wire format).
 * Based on CBOR encoding rules.
 *
 * @since 2.0.0
 * @category model
 */
export type TransactionMetadatumEncoded =
  // Text string
  | string
  // Int (encoded as string)
  | string
  // Bytes (encoded as hex string)
  | string
  // Map (encoded as array of [key, value] pairs)
  | ReadonlyArray<readonly [TransactionMetadatumEncoded, TransactionMetadatumEncoded]>
  // Array
  | ReadonlyArray<TransactionMetadatumEncoded>

/**
 * Transaction metadata type definition (runtime type).
 *
 * Transaction metadata supports text strings, integers, byte arrays, arrays, and maps.
 * Following CIP-10 standard metadata registry.
 *
 * @since 2.0.0
 * @category model
 */
export type TransactionMetadatum =
  // Text string
  | string
  // Integer (runtime as bigint)
  | bigint
  // Bytes (runtime as Uint8Array)
  | Uint8Array
  // Map (using standard Map)
  | globalThis.Map<TransactionMetadatum, TransactionMetadatum>
  // Array
  | ReadonlyArray<TransactionMetadatum>

/**
 * TransactionMetadatumMap type alias
 *
 * @since 2.0.0
 * @category model
 */
export type Map = globalThis.Map<TransactionMetadatum, TransactionMetadatum>

/**
 * TransactionMetadatumList type alias
 *
 * @since 2.0.0
 * @category model
 */
export type List = ReadonlyArray<TransactionMetadatum>

/**
 * Schema for TransactionMetadatum map type
 *
 * @category schemas
 * @since 2.0.0
 */
export const MapSchema = Schema.Map({
  key: Schema.suspend(
    (): Schema.Schema<TransactionMetadatum, TransactionMetadatumEncoded> => TransactionMetadatumSchema
  ).annotations({
    identifier: "TransactionMetadatum.Map.Key",
    title: "Map Key",
    description: "The key of the metadata map, must be a TransactionMetadatum type"
  }),
  value: Schema.suspend(
    (): Schema.Schema<TransactionMetadatum, TransactionMetadatumEncoded> => TransactionMetadatumSchema
  ).annotations({
    identifier: "TransactionMetadatum.Map.Value",
    title: "Map Value",
    description: "The value of the metadata map, must be a TransactionMetadatum type"
  })
}).annotations({
  identifier: "TransactionMetadatum.Map",
  title: "Metadata Map",
  description: "A map of TransactionMetadatum key-value pairs"
})

/**
 * Schema for TransactionMetadatum list type
 *
 * @category schemas
 * @since 2.0.0
 */
export const ListSchema = Schema.Array(
  Schema.suspend((): Schema.Schema<TransactionMetadatum, TransactionMetadatumEncoded> => TransactionMetadatumSchema)
).annotations({
  identifier: "TransactionMetadatum.List",
  title: "Metadata List",
  description: "An array of TransactionMetadatum values"
})

/**
 * Schema for TransactionMetadatum string type
 *
 * @category schemas
 * @since 2.0.0
 */
export const TextSchema = Schema.String.annotations({
  identifier: "TransactionMetadatum.Text",
  title: "Metadata Text",
  description: "A text string value in transaction metadata"
})

/**
 * Schema for TransactionMetadatum integer type
 *
 * @category schemas
 * @since 2.0.0
 */
export const IntSchema = Numeric.Int64.annotations({
  identifier: "TransactionMetadatum.Int",
  title: "Metadata Integer",
  description: "An integer value in transaction metadata (64-bit signed)"
})

/**
 * Schema for TransactionMetadatum bytes type
 *
 * @category schemas
 * @since 2.0.0
 */
export const BytesSchema = Schema.Uint8ArrayFromHex.annotations({
  identifier: "TransactionMetadatum.Bytes",
  title: "Metadata Bytes",
  description: "A byte array value in transaction metadata"
})

/**
 * Union schema for all types of transaction metadata.
 *
 * @since 2.0.0
 * @category schemas
 */
export const TransactionMetadatumSchema = Schema.Union(
  // Map: ReadonlyArray<[E, E]> <-> Map<T, T>
  MapSchema,

  // List: ReadonlyArray<E> <-> ReadonlyArray<T>
  ListSchema,

  // Int: string <-> bigint
  IntSchema,

  // Bytes: hex string <-> Uint8Array
  BytesSchema,

  // Text: string <-> string
  TextSchema
).annotations({
  identifier: "TransactionMetadatum",
  description: "Transaction metadata supporting text, integers, bytes, arrays, and maps"
})

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: TransactionMetadatum): void => {
  if (typeof v === "bigint") {
    if (v >= 0n) w.writeUint(v)
    else w.writeNint(v)
  } else if (v instanceof Uint8Array) {
    w.writeBytes(v)
  } else if (typeof v === "string") {
    w.writeText(v)
  } else if (Array.isArray(v)) {
    w.writeArrayHeader(v.length)
    for (const item of v) write(w, item)
    w.writeArrayBreak()
  } else if (v instanceof Map) {
    w.writeMapHeader(v.size)
    for (const [key, value] of v.entries()) {
      write(w, key)
      write(w, value)
    }
    w.writeMapBreak()
  }
}

export const read = (r: CborReader): TransactionMetadatum => {
  const mt = r.peekMajorType()
  switch (mt) {
    case 0: return r.readUint()
    case 1: return r.readNint()
    case 2: return r.readBytes()
    case 3: return r.readText()
    case 4: {
      const count = r.readArrayHeader()
      const items: Array<TransactionMetadatum> = []
      if (count === -1) {
        while (!r.isBreak()) items.push(read(r))
      } else {
        for (let i = 0; i < count; i++) items.push(read(r))
      }
      return items
    }
    case 5: {
      const count = r.readMapHeader()
      const map = new globalThis.Map<TransactionMetadatum, TransactionMetadatum>()
      if (count === -1) {
        while (!r.isBreak()) {
          const key = read(r)
          const value = read(r)
          map.set(key, value)
        }
      } else {
        for (let i = 0; i < count; i++) {
          const key = read(r)
          const value = read(r)
          map.set(key, value)
        }
      }
      return map
    }
    default:
      throw new Error(`Unsupported CBOR major type ${mt} in TransactionMetadatum`)
  }
}

// ============================================================================
// CBOR Functions
// ============================================================================

/**
 * Schema transformer for TransactionMetadatum from CBOR bytes.
 *
 * Uses Schema.typeSchema(TransactionMetadatumSchema) because CBOR.FromBytes
 * returns runtime types (bigint, Uint8Array, Map), not encoded types.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(TransactionMetadatumSchema),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "TransactionMetadatum.FromCBORBytes" })

/**
 * Schema transformer for TransactionMetadatum from CBOR hex string.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "TransactionMetadatum.FromCBORHex" })

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Schema-derived structural equality for TransactionMetadatum values.
 * Handles maps, lists, ints, bytes, and text via the
 * recursive TransactionMetadatumSchema definition — no hand-rolled comparison needed.
 *
 * @since 2.0.0
 * @category equality
 */
export const equals: (a: TransactionMetadatum, b: TransactionMetadatum) => boolean = Schema.equivalence(
  TransactionMetadatumSchema
)

/**
 * FastCheck arbitrary for generating random TransactionMetadatum instances.
 *
 * @since 2.0.0
 * @category testing
 */
const I64_MIN = -(1n << 63n)
const I64_MAX = (1n << 63n) - 1n
const int64Arbitrary = FastCheck.bigInt({ min: I64_MIN, max: I64_MAX })

export const arbitrary: FastCheck.Arbitrary<TransactionMetadatum> = FastCheck.oneof(
  FastCheck.string(),
  int64Arbitrary,
  FastCheck.uint8Array({ minLength: 1, maxLength: 64 }),
  FastCheck.array(FastCheck.oneof(FastCheck.string(), int64Arbitrary), { maxLength: 5 }),
  FastCheck.uniqueArray(FastCheck.tuple(FastCheck.string(), int64Arbitrary), {
    maxLength: 5,
    selector: ([key]) => key // Ensure unique keys
  }).map((entries) => new globalThis.Map(entries))
)

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a TransactionMetadatum from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a TransactionMetadatum from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a TransactionMetadatum to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: TransactionMetadatum, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert a TransactionMetadatum to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: TransactionMetadatum, profile?: EncodingProfile) =>
  Schema.encodeSync(Schema.Uint8ArrayFromHex)(toCBORBytes(data, profile))

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a text TransactionMetadatum from a string value.
 *
 * @since 2.0.0
 * @category constructors
 */
export const text = (value: string): string => value

/**
 * Create an integer TransactionMetadatum from a bigint value.
 *
 * @since 2.0.0
 * @category constructors
 */
export const int = (value: bigint): bigint => value

/**
 * Create a bytes TransactionMetadatum from a Uint8Array value.
 *
 * @since 2.0.0
 * @category constructors
 */
export const bytes = (value: Uint8Array): Uint8Array => value

/**
 * Create an array TransactionMetadatum from an array of TransactionMetadatum values.
 *
 * @since 2.0.0
 * @category constructors
 */
export const array = (value: Array<TransactionMetadatum>): List => value

/**
 * Create a map TransactionMetadatum from a Map of TransactionMetadatum key-value pairs.
 *
 * @since 2.0.0
 * @category constructors
 */
export const map = (value: globalThis.Map<TransactionMetadatum, TransactionMetadatum>): Map => value

/**
 * Create a map TransactionMetadatum from an array of key-value pair entries.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromEntries = (entries: Array<[TransactionMetadatum, TransactionMetadatum]>): Map =>
  new globalThis.Map<TransactionMetadatum, TransactionMetadatum>(entries)
