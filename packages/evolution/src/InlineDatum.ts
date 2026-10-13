import { Equal, Hash, Inspectable, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as PlutusData from "./Data.js"
import * as OriginalBytes from "./OriginalBytes.js"

/**
 * Schema for InlineDatum representing inline plutus data embedded directly in the transaction output.
 *
 * @since 2.0.0
 * @category schemas
 */
export class InlineDatum extends Schema.TaggedClass<InlineDatum>()("InlineDatum", {
  data: PlutusData.DataSchema
}) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return { _tag: "InlineDatum" as const, data: this.data }
  }

  /**
   * @since 2.0.0
   * @category string
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * @since 2.0.0
   * @category inspect
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return that instanceof InlineDatum && PlutusData.equals(this.data, that.data)
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.cached(this, PlutusData.hash(this.data))
  }
}

/**
 * FastCheck arbitrary for generating random InlineDatum instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = PlutusData.arbitrary.map((data) => new InlineDatum({ data }))

/**
 * An inline datum from the CBOR a backend sent, KEEPING those bytes.
 *
 * ⚠️ **Use this, not the constructor, for any datum that came off a wire.** `new InlineDatum(…)`
 * records nothing, so the datum's only remaining representation is the decoded tree -- and
 * re-deriving bytes from a tree reframes an EMPTY indefinite array (`9fff` becomes `80`), which
 * changes the hash. A script consumer matches a datum BY its hash, and `cip113`/`cip139` report
 * `datum_hex` only from the `OriginalBytes` channel, absent rather than re-derived.
 *
 * Every provider that reads a datum off a backend goes through here, so "the bytes survive" is
 * one decision in one place rather than four copies that can each be forgotten -- which is how
 * three of those four came to drop them.
 *
 * @since 2.7.0
 * @category constructors
 */
export const fromCBORHex = (hex: string): InlineDatum =>
  OriginalBytes.record(new InlineDatum({ data: PlutusData.fromCBORHex(hex) }), Bytes.fromHex(hex))

/**
 * As {@link fromCBORHex}, for bytes already decoded from the wire.
 *
 * @since 2.7.0
 * @category constructors
 */
export const fromCBORBytes = (bytes: Uint8Array): InlineDatum =>
  OriginalBytes.record(new InlineDatum({ data: PlutusData.fromCBORBytes(bytes) }), bytes)

/**
 * Type guard to check if a value is an InlineDatum.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isInlineDatum = Schema.is(InlineDatum)
