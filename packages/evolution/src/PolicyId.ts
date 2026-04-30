import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Hash28 from "./Hash28.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * PolicyId as a TaggedClass representing a minting policy identifier.
 * A PolicyId is a script hash (hash28) that identifies a minting policy.
 *
 * Note: PolicyId is equivalent to ScriptHash as defined in the CDDL:
 * policy_id = script_hash
 * script_hash = hash28
 *
 * @since 2.0.0
 * @category model
 */
export class PolicyId extends Schema.TaggedClass<PolicyId>()("PolicyId", {
  hash: Hash28.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "PolicyId" as const,
      hash: Hash28.toHex(this.hash)
    }
  }

  toString(): string {
    return Hash28.toHex(this.hash)
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof PolicyId && Bytes.equals(this.hash, that.hash)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.hash))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: PolicyId): void => w.writeBytes(v.hash)
export const read = (r: CborReader): PolicyId => new PolicyId({ hash: r.readBytesView() })

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema transformer from bytes to PolicyId.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(PolicyId),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new PolicyId({ hash: bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.hash)
  }
).annotations({ identifier: "PolicyId.FromBytes" })

/**
 * Schema transformer from hex string to PolicyId.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(Schema.Uint8ArrayFromHex, FromBytes).annotations({
  identifier: "PolicyId.FromHex"
})

/**
 * Check if the given value is a valid PolicyId
 *
 * @since 2.0.0
 * @category predicates
 */
export const isPolicyId = Schema.is(PolicyId)

/**
 * FastCheck arbitrary for generating random PolicyId instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<PolicyId> = FastCheck.uint8Array({
  minLength: Hash28.BYTES_LENGTH,
  maxLength: Hash28.BYTES_LENGTH
}).map((bytes) => new PolicyId({ hash: bytes }, { disableValidation: true }))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse PolicyId from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = Schema.decodeSync(FromBytes)

/**
 * Parse PolicyId from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = Schema.decodeSync(FromHex)

/**
 * Encode PolicyId to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (v: PolicyId): Uint8Array => v.hash

/**
 * Encode PolicyId to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (v: PolicyId): string => Bytes.toHex(v.hash)
