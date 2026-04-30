import { FastCheck, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as PlutusData from "./Data.js"
import * as DatumHash from "./DatumHash.js"
import * as InlineDatum from "./InlineDatum.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for DatumOption representing optional datum information in transaction outputs.
 *
 * CDDL: datum_option = [0, Bytes32// 1, data]
 *
 * Where:
 * - [0, Bytes32] represents a datum hash reference
 * - [1, data] represents inline plutus data
 *
 * @since 2.0.0
 * @category schemas
 */
export const DatumOptionSchema = Schema.Union(DatumHash.DatumHash, InlineDatum.InlineDatum).annotations({
  identifier: "DatumOption"
})

/**
 * Type alias for DatumOption representing optional datum information.
 * Can be either a hash reference to datum data or inline plutus data.
 *
 * @since 2.0.0
 * @category model
 */
export type DatumOption = typeof DatumOptionSchema.Type

/**
 * Check if a DatumOption is a datum hash.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isDatumHash = DatumHash.isDatumHash

/**
 * Check if a DatumOption is inline data.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isInlineDatum = InlineDatum.isInlineDatum

/**
 * FastCheck arbitrary for generating random DatumOption instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.oneof(DatumHash.arbitrary, InlineDatum.arbitrary)

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: DatumOption): void => {
  if (v._tag === "DatumHash") {
    w.writeArrayHeader(2)
    w.writeSmallUint(0)
    w.writeBytes(v.hash)
    w.writeArrayBreak()
  } else {
    w.writeArrayHeader(2)
    w.writeSmallUint(1)
    w.writeTagHeader(24)
    w.writeBytes(PlutusData.toCBORBytes(v.data))
    w.writeArrayBreak()
  }
}

export const read = (r: CborReader): DatumOption => {
  const count = r.readArrayHeader()
  const tag = r.readSmallUint()
  let result: DatumOption
  switch (tag) {
    case 0: {
      const hash = r.readBytes()
      result = new DatumHash.DatumHash({ hash }, { disableValidation: true })
      break
    }
    case 1: {
      r.readTagHeader() // tag 24
      const dataBytes = r.readBytes()
      result = new InlineDatum.InlineDatum(
        { data: PlutusData.fromCBORBytes(dataBytes) },
        { disableValidation: true }
      )
      break
    }
    default:
      throw new Error(`Invalid DatumOption tag: ${tag}. Expected 0 or 1.`)
  }
  if (count === -1) r.isBreak()
  return result
}

/**
 * CBOR bytes transformation schema for DatumOption.
 * Transforms between Uint8Array and DatumOption using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(DatumOptionSchema),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "DatumOption.FromCBORBytes" })

/**
 * CBOR hex transformation schema for DatumOption.
 * Transforms between hex string and DatumOption using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "DatumOption.FromCBORHex" })

/**
 * Convert DatumOption to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: DatumOption, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finish()
}

/**
 * Convert DatumOption to CBOR hex.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: DatumOption, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Convert CBOR bytes to DatumOption.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to DatumOption.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)
