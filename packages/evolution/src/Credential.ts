import { FastCheck, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as KeyHash from "./KeyHash.js"
import * as ScriptHash from "./ScriptHash.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Credential schema representing either a key hash or script hash
 * credential = [0, addr_keyhash // 1, script_hash]
 * Used to identify ownership of addresses or stake rights
 *
 * @since 2.0.0
 * @category schemas
 */
export const Credential = Schema.Union(KeyHash.KeyHash, ScriptHash.ScriptHash)

/**
 * Type representing a credential that can be either a key hash or script hash
 * Used in various address formats to identify ownership
 *
 * @since 2.0.0
 * @category model
 */
export type Credential = typeof Credential.Type
export type CredentialEncoded = typeof Credential.Encoded

export const makeKeyHash = (hash: Uint8Array): Credential => new KeyHash.KeyHash({ hash })
export const makeScriptHash = (hash: Uint8Array): Credential => new ScriptHash.ScriptHash({ hash })

/**
 * Check if the given value is a valid Credential
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = Schema.is(Credential)

// ============================================================================
// Write / Read
// ============================================================================

export const write = (w: CborWriter, v: Credential): void => {
  w.writeArrayHeader(2)
  switch (v._tag) {
    case "KeyHash": w.writeSmallUint(0); w.writeBytes(v.hash); break
    case "ScriptHash": w.writeSmallUint(1); w.writeBytes(v.hash); break
  }
  w.writeArrayBreak()
}

export const read = (r: CborReader): Credential => {
  const count = r.readArrayHeader()
  const tag = r.readSmallUint()
  let result: Credential
  switch (tag) {
    case 0: result = new KeyHash.KeyHash({ hash: r.readBytesView() }); break
    case 1: result = new ScriptHash.ScriptHash({ hash: r.readBytesView() }); break
    default: throw new Error(`Credential: unknown tag ${tag}`)
  }
  if (count === -1) r.isBreak()
  return result
}

// ============================================================================
// Schemas (legacy-compatible)
// ============================================================================
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Credential),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Credential.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Credential.FromCBORHex" })

/**
 * FastCheck arbitrary for generating random Credential instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.oneof(KeyHash.arbitrary, ScriptHash.arbitrary)

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Parse a Credential from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a Credential from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a Credential to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (credential: Credential, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, credential)
  return w.finishView()
}

/**
 * Convert a Credential to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (credential: Credential, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(credential, profile))
