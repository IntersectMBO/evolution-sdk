import { Either as E, FastCheck, ParseResult, Schema } from "effect"

import * as CBOR from "./CBOR.js"
import * as PlutusData from "./Data.js"
import * as DatumHash from "./DatumHash.js"
import * as InlineDatum from "./InlineDatum.js"
import * as OriginalBytes from "./OriginalBytes.js"

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

export const CDDLSchema = Schema.Union(
  Schema.Tuple(Schema.Literal(0n), CBOR.ByteArray), // [0, Bytes32]
  Schema.Tuple(Schema.Literal(1n), CBOR.tag(24, Schema.Uint8ArrayFromSelf)) // [1, tag(24, bytes)] - PlutusData as bytes in tag 24
)

/**
 * CDDL schema for DatumOption, as in {@link FromCDDL}, that writes a new
 * inline datum with the `plutusData` options. A decoded inline datum keeps
 * its original bytes.
 *
 * @since 2.0.0
 * @category schemas
 */
export const makeFromCDDL = (plutusData: CBOR.CodecOptions) =>
  Schema.transformOrFail(CDDLSchema, Schema.typeSchema(DatumOptionSchema), {
    strict: true,
    encode: (toA) =>
      E.gen(function* () {
        const result =
          toA._tag === "DatumHash"
            ? ([0n, toA.hash] as const) // Encode as [0, Bytes32]
            : ([
                1n,
                {
                  _tag: "Tag" as const,
                  tag: 24 as const,
                  // Write back the decoded bytes when present, so the datum keeps its original layout
                  value: OriginalBytes.get(toA) ?? PlutusData.toCBORBytes(toA.data, plutusData)
                }
              ] as const) // Encode as [1, tag(24, bytes)]
        return yield* E.right(result)
      }),
    decode: ([tag, value], _, ast) =>
      E.gen(function* () {
        if (tag === 0n) {
          // Decode as DatumHash
          return yield* E.right(new DatumHash.DatumHash({ hash: value }, { disableValidation: true }))
        } else if (tag === 1n) {
          // Decode as InlineDatum - value is now a CBOR tag 24 wrapper containing bytes
          const taggedValue = value as { _tag: "Tag"; tag: number; value: Uint8Array }
          if (taggedValue._tag !== "Tag" || taggedValue.tag !== 24) {
            return yield* E.left(
              new ParseResult.Type(
                ast,
                [tag, value],
                `Invalid InlineDatum format: expected tag 24, got ${taggedValue._tag} with tag ${taggedValue.tag}`
              )
            )
          }
          return yield* E.right(
            OriginalBytes.record(
              new InlineDatum.InlineDatum(
                {
                  data: PlutusData.fromCBORBytes(taggedValue.value)
                },
                { disableValidation: true }
              ),
              taggedValue.value
            )
          )
        }
        return yield* E.left(new ParseResult.Type(ast, [tag, value], `Invalid DatumOption tag: ${tag}. Expected 0 or 1.`))
      })
  }).annotations({
    identifier: "DatumOption.DatumOptionCDDLSchema",
    description: "Transforms CBOR structure to DatumOption"
  })

/**
 * CDDL schema for DatumOption.
 * datum_option = [0, Bytes32] / [1, #6.24(bytes)]
 *
 * Where:
 * - [0, Bytes32] represents a datum hash (tag 0 with 32-byte hash)
 * - [1, #6.24(bytes)] represents inline data (tag 1 with CBOR tag 24 containing plutus data as bytes)
 *
 * A new inline datum is written with `Data.DEFAULT_CBOR_OPTIONS`.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCDDL = makeFromCDDL(PlutusData.DEFAULT_CBOR_OPTIONS)

/**
 * CBOR bytes transformation schema for DatumOption.
 * Transforms between Uint8Array and DatumOption using CBOR encoding.
 *
 * A new inline datum is written with the `plutusData` options, the rest with
 * the `ledger` options. Plain options are read as `CBOR.toTxCodecOptions`
 * reads them.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = (options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS) => {
  const { ledger, plutusData } = CBOR.toTxCodecOptions(options)
  return Schema.compose(
    CBOR.FromBytes(ledger), // Uint8Array → CBOR
    plutusData === PlutusData.DEFAULT_CBOR_OPTIONS ? FromCDDL : makeFromCDDL(plutusData) // CBOR → DatumOption
  ).annotations({
    identifier: "DatumOption.FromCBORBytes",
    description: "Transforms CBOR bytes to DatumOption"
  })
}

/**
 * CBOR hex transformation schema for DatumOption, as in {@link FromCBORBytes}.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = (options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS) =>
  Schema.compose(
    Schema.Uint8ArrayFromHex, // string → Uint8Array
    FromCBORBytes(options) // Uint8Array → DatumOption
  ).annotations({
    identifier: "DatumOption.FromCBORHex",
    description: "Transforms CBOR hex string to DatumOption"
  })

/**
 * Convert DatumOption to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (
  data: DatumOption,
  options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS
) =>
  Schema.encodeSync(FromCBORBytes(options))(data)

/**
 * Convert DatumOption to CBOR hex.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (
  data: DatumOption,
  options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS
) =>
  Schema.encodeSync(FromCBORHex(options))(data)

/**
 * Convert CBOR bytes to DatumOption.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = (bytes: Uint8Array, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.decodeSync(FromCBORBytes(options))(bytes)

/**
 * Convert CBOR hex string to DatumOption.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = (hex: string, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.decodeSync(FromCBORHex(options))(hex)
