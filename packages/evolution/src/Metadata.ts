import { FastCheck, ParseResult, Schema } from "effect"

import * as Numeric from "./Numeric.js"
import * as TransactionMetadatum from "./TransactionMetadatum.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Type representing a transaction metadatum label (uint).
 *
 * @since 2.0.0
 * @category model
 */
export type MetadataLabel = typeof MetadataLabel.Type

/**
 * Schema for transaction metadatum label (uint64 per Cardano CDDL spec).
 * Labels must be in range 0 to 2^64-1.
 *
 * @since 2.0.0
 * @category schemas
 */
export const MetadataLabel = Numeric.Uint64Schema.annotations({
  identifier: "Metadata.MetadataLabel",
  description: "A transaction metadatum label (0 to 2^64-1)"
})

/**
 * Schema for transaction metadata (map from labels to metadata).
 * ```
 * Represents: metadata = {* transaction_metadatum_label => transaction_metadatum}
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export const Metadata = Schema.Map({
  key: MetadataLabel,
  value: TransactionMetadatum.TransactionMetadatumSchema
}).annotations({
  identifier: "Metadata",
  description: "Transaction metadata as a map from labels to transaction metadata values"
})

export type Metadata = typeof Metadata.Type

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Metadata): void => {
  w.writeMapHeader(v.size)
  for (const [label, metadatum] of v.entries()) {
    w.writeUint(label)
    TransactionMetadatum.write(w, metadatum)
  }
  w.writeMapBreak()
}

export const read = (r: CborReader): Metadata => {
  const count = r.readMapHeader()
  const map = new Map<bigint, TransactionMetadatum.TransactionMetadatum>()
  if (count === -1) {
    while (!r.isBreak()) {
      const label = r.readUint()
      const metadatum = TransactionMetadatum.read(r)
      map.set(label, metadatum)
    }
  } else {
    for (let i = 0; i < count; i++) {
      const label = r.readUint()
      const metadatum = TransactionMetadatum.read(r)
      map.set(label, metadatum)
    }
  }
  return map as Metadata
}

/**
 * Schema transformer for Metadata from CBOR bytes.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Metadata),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Metadata.FromCBORBytes" })

/**
 * Schema transformer for Metadata from CBOR hex string.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Metadata.FromCBORHex" })

/**
 * FastCheck arbitrary for generating random Metadata instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary: FastCheck.Arbitrary<Metadata> = FastCheck.array(
  FastCheck.tuple(
    FastCheck.bigInt({ min: 0n, max: 255n }), // MetadataLabel (uint8)
    TransactionMetadatum.arbitrary
  ),
  { maxLength: 5 }
).map((entries) => fromEntries(entries))

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse Metadata from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse Metadata from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert Metadata to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: Metadata, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert Metadata to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: Metadata, profile?: EncodingProfile) =>
  Schema.encodeSync(Schema.Uint8ArrayFromHex)(toCBORBytes(data, profile))

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create Metadata from an array of label-metadatum pairs.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromEntries = (entries: Array<[MetadataLabel, TransactionMetadatum.TransactionMetadatum]>): Metadata =>
  new Map(entries)

/**
 * Create an empty Metadata map.
 *
 * @since 2.0.0
 * @category constructors
 */
export const empty = (): Metadata => new Map() as Metadata

/**
 * Add or update a metadata entry.
 *
 * @since 2.0.0
 * @category constructors
 */
export const set = (
  metadata: Metadata,
  label: MetadataLabel,
  metadatum: TransactionMetadatum.TransactionMetadatum
): Metadata => {
  const newMap = new Map(metadata)
  newMap.set(label, metadatum)
  return newMap as Metadata
}

/**
 * Get a metadata entry by label.
 *
 * @since 2.0.0
 * @category utilities
 */
export const get = (metadata: Metadata, label: MetadataLabel): TransactionMetadatum.TransactionMetadatum | undefined =>
  metadata.get(label)

/**
 * Check if a label exists in the metadata.
 *
 * @since 2.0.0
 * @category utilities
 */
export const has = (metadata: Metadata, label: MetadataLabel): boolean => metadata.has(label)

/**
 * Remove a metadata entry by label.
 *
 * @since 2.0.0
 * @category constructors
 */
export const remove = (metadata: Metadata, label: MetadataLabel): Metadata => {
  const newMap = new Map(metadata)
  newMap.delete(label)
  return newMap as Metadata
}

/**
 * Get the size (number of entries) of the metadata.
 *
 * @since 2.0.0
 * @category utilities
 */
export const size = (metadata: Metadata): number => metadata.size

/**
 * Get all labels in the metadata.
 *
 * @since 2.0.0
 * @category utilities
 */
export const labels = (metadata: Metadata): Array<MetadataLabel> => Array.from(metadata.keys())

/**
 * Get all metadata values in the metadata.
 *
 * @since 2.0.0
 * @category utilities
 */
export const values = (metadata: Metadata): Array<TransactionMetadatum.TransactionMetadatum> =>
  Array.from(metadata.values())

/**
 * Get all entries in the metadata.
 *
 * @since 2.0.0
 * @category utilities
 */
export const entries = (metadata: Metadata): Array<[MetadataLabel, TransactionMetadatum.TransactionMetadatum]> =>
  Array.from(metadata.entries())
