import { blake2b } from "@noble/hashes/blake2"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Hash28 from "./Hash28.js"
import * as NativeScripts from "./NativeScripts.js"
import type * as Script from "./Script.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for ScriptHash representing a script hash credential.
 * ```
 * script_hash = hash28
 * ```
 * Follows CIP-0019 binary representation.
 *
 * Stores raw 28-byte value for performance.
 *
 * @since 2.0.0
 * @category schemas
 */
export class ScriptHash extends Schema.TaggedClass<ScriptHash>()("ScriptHash", {
  hash: Hash28.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "ScriptHash" as const,
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
    return that instanceof ScriptHash && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.hash))
  }
}

// ============================================================================
// Write / Read
// ============================================================================

export const write = (w: CborWriter, v: ScriptHash): void => w.writeBytes(v.hash)
export const read = (r: CborReader): ScriptHash => new ScriptHash({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for transforming between Uint8Array and ScriptHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(ScriptHash),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new ScriptHash({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.hash)
  }
).annotations({ identifier: "ScriptHash.FromBytes" })

/**
 * Schema for transforming between hex string and ScriptHash.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(Schema.Uint8ArrayFromHex, FromBytes).annotations({
  identifier: "ScriptHash.FromHex"
})

/**
 * Parse a ScriptHash from raw bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse a ScriptHash from a hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Convert a ScriptHash to raw bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: ScriptHash): Uint8Array => v.hash

/**
 * Convert a ScriptHash to a hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: ScriptHash): string => Bytes.toHex(v.hash)

/**
 * FastCheck arbitrary for generating random ScriptHash instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<ScriptHash> = FastCheck.uint8Array({ minLength: 28, maxLength: 28 }).map(
  (bytes) => new ScriptHash({ hash: bytes })
)

/**
 * Compute a script hash (policy id) from any Script variant.
 *
 * @since 2.0.0
 * @category computation
 */
export const fromScript = (script: Script.Script): ScriptHash => {
  let tag: number
  let body: Uint8Array

  switch (script._tag) {
    case "PlutusV1":
      tag = 0x01
      body = script.bytes
      break

    case "PlutusV2":
      tag = 0x02
      body = script.bytes
      break

    case "PlutusV3":
      tag = 0x03
      body = script.bytes
      break

    case "NativeScript":
      tag = 0x00
      body = NativeScripts.toCBORBytes(script)
      break

    default:
      throw new Error(`Unknown script type: ${(script as any)._tag}`)
  }

  const prefixed = new Uint8Array(1 + body.length)
  prefixed[0] = tag
  prefixed.set(body, 1)
  const hashBytes = blake2b(prefixed, { dkLen: 28 })
  return new ScriptHash({ hash: hashBytes }, { disableValidation: true })
}
