import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * VrfKeyHash is a 32-byte hash representing a VRF verification key.
 * vrf_keyhash = Bytes32
 *
 * @since 2.0.0
 * @category schemas
 */
export class VrfKeyHash extends Schema.TaggedClass<VrfKeyHash>()("VrfKeyHash", {
  hash: Bytes32.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "VrfKeyHash" as const,
      hash: Bytes.toHex(this.hash)
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof VrfKeyHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.array(Array.from(this.hash)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: VrfKeyHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): VrfKeyHash => new VrfKeyHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(VrfKeyHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new VrfKeyHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.hash)
  }
).annotations({
  identifier: "VrfKeyHash.FromBytes"
})

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex,
  FromBytes
).annotations({
  identifier: "VrfKeyHash.FromHex"
})

/**
 * FastCheck arbitrary for generating random VrfKeyHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({
  minLength: Bytes32.BYTES_LENGTH,
  maxLength: Bytes32.BYTES_LENGTH
}).map((bytes) => new VrfKeyHash({ hash: bytes }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse VrfKeyHash from raw bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse VrfKeyHash from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode VrfKeyHash to raw bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: VrfKeyHash): Uint8Array => v.hash

/**
 * Encode VrfKeyHash to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: VrfKeyHash): string => Bytes.toHex(v.hash)
