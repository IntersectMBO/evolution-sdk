import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Numeric from "./Numeric.js"
import * as TransactionHash from "./TransactionHash.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for TransactionInput representing a transaction input with transaction id and index.
 *
 * ```
 * transaction_input = [transaction_id : transaction_id, index : uint .size 2]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class TransactionInput extends Schema.TaggedClass<TransactionInput>()("TransactionInput", {
  transactionId: TransactionHash.TransactionHash,
  index: Numeric.Uint16Schema
}) {
  toJSON() {
    return {
      _tag: this._tag,
      transactionId: this.transactionId.toJSON(),
      index: this.index.toString()
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof TransactionInput &&
      this.index === that.index &&
      Equal.equals(this.transactionId, that.transactionId)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.transactionId))(Hash.number(Number(this.index))))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: TransactionInput): void => {
  w.writeArrayHeader(2)
  TransactionHash.write(w, v.transactionId)
  w.writeSmallUint(Number(v.index))
  w.writeArrayBreak()
}

export const read = (r: CborReader): TransactionInput => {
  const start = r.position()
  const count = r.readArrayHeader()
  const inp = new TransactionInput({
    transactionId: TransactionHash.read(r),
    index: BigInt(r.readSmallUint()),
  })
  if (count === -1) r.isBreak()
  capture(inp, r.buffer().subarray(start, r.position()))
  return inp
}

/**
 * Check if the given value is a valid TransactionInput.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isTransactionInput = Schema.is(TransactionInput)

// ============================================================================
// Schemas (legacy-compatible)
// ============================================================================

/**
 * CBOR bytes transformation schema for TransactionInput.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(TransactionInput),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "TransactionInput.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "TransactionInput.FromCBORHex" })

/**
 * FastCheck arbitrary for TransactionInput instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.tuple(TransactionHash.arbitrary, Numeric.Uint16Arbitrary).map(
  ([transactionId, index]) =>
    new TransactionInput({
      transactionId,
      index
    })
)

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Convert CBOR bytes to TransactionInput.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to TransactionInput.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert TransactionInput to CBOR bytes.
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORBytes = (data: TransactionInput, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert TransactionInput to CBOR hex string.
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORHex = (data: TransactionInput, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
