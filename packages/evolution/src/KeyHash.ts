import { blake2b } from "@noble/hashes/blake2"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Hash28 from "./Hash28.js"
import type { PrivateKey } from "./PrivateKey.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"
import * as VKey from "./VKey.js"

/**
 * KeyHash
 *
 * CDDL:
 * ```
 * addr_keyhash = hash28
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class KeyHash extends Schema.TaggedClass<KeyHash>()("KeyHash", {
  hash: Hash28.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "KeyHash" as const,
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
    return that instanceof KeyHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.hash))
  }
}

// ============================================================================
// Write / Read
// ============================================================================

export const write = (w: CborWriter, v: KeyHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): KeyHash => new KeyHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema transformer from bytes to KeyHash.
 *
 * @since 2.0.0
 * @category transformer
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(KeyHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new KeyHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.hash)
  }
).annotations({ identifier: "KeyHash.FromBytes" })

/**
 * Schema transformer from hex string to KeyHash.
 *
 * @since 2.0.0
 * @category transformer
 */
export const FromHex = Schema.compose(Schema.Uint8ArrayFromHex, FromBytes).annotations({
  identifier: "KeyHash.FromHex"
})

/**
 * Decode a KeyHash from raw bytes.
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Decode a KeyHash from a hex string.
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Convert a KeyHash to raw bytes.
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const toBytes = (v: KeyHash): Uint8Array => v.hash

/**
 * Convert a KeyHash to a hex string.
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const toHex = (v: KeyHash): string => Bytes.toHex(v.hash)

/**
 * FastCheck arbitrary for generating random KeyHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<KeyHash> = FastCheck.uint8Array({ minLength: 28, maxLength: 28 }).map(
  (bytes) => new KeyHash({ hash: bytes })
)

/**
 * Create a KeyHash from a PrivateKey
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromPrivateKey = (privateKey: PrivateKey): KeyHash => {
  const vkey = VKey.fromPrivateKey(privateKey)
  const publicKeyBytes = vkey.bytes
  const keyHashBytes = blake2b(publicKeyBytes, { dkLen: 28 })
  return KeyHash.make({ hash: keyHashBytes }, { disableValidation: true })
}

/**
 * Create a KeyHash from a VKey
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromVKey = (vkey: VKey.VKey): KeyHash => {
  const publicKeyBytes = vkey.bytes
  const keyHashBytes = blake2b(publicKeyBytes, { dkLen: 28 })
  return KeyHash.make({ hash: keyHashBytes }, { disableValidation: true })
}
