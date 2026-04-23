import { blake2b } from "@noble/hashes/blake2"
import { bech32 } from "@scure/base"
import { Effect as Eff, Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Hash28 from "./Hash28.js"
import type { PrivateKey } from "./PrivateKey.js"
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

/**
 * Schema transformer from bytes to KeyHash.
 *
 * @since 2.0.0
 * @category transformer
 */
export const FromBytes = Schema.transform(Schema.typeSchema(Hash28.BytesFromHex), Schema.typeSchema(KeyHash), {
  strict: true,
  decode: (bytes) => new KeyHash({ hash: bytes }, { disableValidation: true }), // Disable validation since we already check length in Hash28
  encode: (keyHash) => keyHash.hash
}).annotations({
  identifier: "KeyHash.FromBytes"
})

/**
 * Schema transformer from hex string to KeyHash.
 *
 * @since 2.0.0
 * @category transformer
 */
export const FromHex = Schema.compose(Hash28.BytesFromHex, FromBytes).annotations({
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
export const toBytes = Schema.encodeSync(FromBytes)

/**
 * Convert a KeyHash to a hex string.
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const toHex = Schema.encodeSync(FromHex)

/**
 * Schema transformer from bech32 string (addr_vkh1...) to KeyHash.
 * Uses the CIP-0005 `addr_vkh` prefix for address verification key hashes.
 *
 * @since 2.0.0
 * @category transformer
 */
export const FromBech32 = Schema.transformOrFail(Schema.String, Schema.typeSchema(KeyHash), {
  strict: true,
  encode: (keyHash) =>
    Eff.gen(function* () {
      const words = bech32.toWords(keyHash.hash)
      return bech32.encode("addr_vkh", words, false)
    }),
  decode: (fromA, _, ast) =>
    Eff.gen(function* () {
      const result = yield* Eff.try({
        try: () => {
          const decoded = bech32.decode(fromA as any, false)
          return new Uint8Array(bech32.fromWords(decoded.words))
        },
        catch: () => new ParseResult.Type(ast, fromA, `Failed to decode Bech32 key hash: ${fromA}`)
      })
      return yield* ParseResult.decode(FromBytes)(result)
    })
}).annotations({
  identifier: "KeyHash.FromBech32",
  description: "Transforms Bech32 addr_vkh string to KeyHash"
})

/**
 * Parse a KeyHash from a bech32 string (addr_vkh1...).
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const fromBech32 = Schema.decodeSync(FromBech32)

/**
 * Convert a KeyHash to a bech32 string (addr_vkh1...).
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const toBech32 = Schema.encodeSync(FromBech32)

/**
 * FastCheck arbitrary for generating random KeyHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<KeyHash> = FastCheck.uint8Array({ minLength: 28, maxLength: 28 }).map(
  (bytes) => new KeyHash({ hash: bytes }, { disableValidation: true })
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
