import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for VrfVkey representing a VRF verification key.
 * vrf_vkey = bytes .size 32
 * Follows the Conway-era CDDL specification.
 *
 * @since 2.0.0
 * @category schemas
 */
export class VrfVkey extends Schema.TaggedClass<VrfVkey>()("VrfVkey", {
  bytes: Bytes32.BytesFromHex
}) {
  toJSON() {
    return { _tag: "VrfVkey" as const, bytes: Bytes.toHex(this.bytes) }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof VrfVkey && Bytes.equals(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: VrfVkey): void => w.writeBytes(v.bytes)
export const read = (r: CborReader): VrfVkey => new VrfVkey({ bytes: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(VrfVkey),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new VrfVkey({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.bytes)
  }
).annotations({ identifier: "VrfVkey.FromBytes" })

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "VrfVkey.FromHex"
})

/**
 * Check if the given value is a valid VrfVkey
 *
 * @since 2.0.0
 * @category predicates
 */
export const isVrfVkey = Schema.is(VrfVkey)

/**
 * FastCheck arbitrary for generating random VrfVkey instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({
  minLength: Bytes32.BYTES_LENGTH,
  maxLength: Bytes32.BYTES_LENGTH
}).map((bytes) => new VrfVkey({ bytes }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse VrfVkey from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse VrfVkey from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode VrfVkey to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: VrfVkey): Uint8Array => v.bytes

/**
 * Encode VrfVkey to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: VrfVkey): string => Bytes.toHex(v.bytes)
