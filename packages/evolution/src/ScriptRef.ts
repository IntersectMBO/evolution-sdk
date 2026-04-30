import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Script from "./Script.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for ScriptRef representing a reference to a script in a transaction output.
 *
 * ```
 * CDDL: script_ref = #6.24(bytes .cbor script)
 * ```
 *
 * This represents the CBOR-encoded script bytes.
 * The script_ref uses CBOR tag 24 to indicate it contains CBOR-encoded script data.
 *
 * @since 2.0.0
 * @category schemas
 */
export class ScriptRef extends Schema.TaggedClass<ScriptRef>()("ScriptRef", {
  bytes: Schema.Uint8ArrayFromHex
}) {
  toJSON() {
    return {
      _tag: "ScriptRef" as const,
      bytes: this.bytes
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof ScriptRef && Bytes.equals(this.bytes, that.bytes)
  }

  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

/**
 * Schema for transforming from bytes to ScriptRef.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromBytes = Schema.transform(Schema.Uint8ArrayFromSelf, Schema.typeSchema(ScriptRef), {
  strict: true,
  decode: (bytes) => new ScriptRef({ bytes }),
  encode: (s) => s.bytes
}).annotations({
  identifier: "ScriptRef.FromBytes"
})

/**
 * Schema for transforming from hex to ScriptRef.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex, // string -> Uint8Array
  FromBytes // Uint8Array -> ScriptRef
).annotations({
  identifier: "ScriptRef.FromHex"
})
/**
 * CBOR bytes transformation schema for ScriptRef.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(ScriptRef),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "ScriptRef.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "ScriptRef.FromCBORHex" })

/**
 * FastCheck arbitrary for generating random ScriptRef instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.uint8Array({
  minLength: 1,
  maxLength: 100
}).chain(() =>
  // Generate a valid Script first, then CBOR-encode it and wrap in tag(24) bytes
  Script.arbitrary.map((script) => {
    // Encode CDDL (CBOR value) -> bytes using canonical options compatible with CML
    const bytes = Script.toCBOR(script)
    return new ScriptRef({ bytes })
  })
)

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: ScriptRef): void => {
  w.writeTagHeader(24)
  w.writeBytes(v.bytes)
}

export const read = (r: CborReader): ScriptRef => {
  const tag = r.readTagHeader()
  if (tag !== 24) throw new Error(`ScriptRef: expected tag 24, got ${tag}`)
  const bytes = r.readBytesView()
  return new ScriptRef({ bytes })
}

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse ScriptRef from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = (bytes: Uint8Array) => Schema.decodeSync(FromBytes)(bytes)

/**
 * Parse ScriptRef from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = (hex: string) => Schema.decodeSync(FromHex)(hex)

/**
 * Parse ScriptRef from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse ScriptRef from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode ScriptRef to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (data: ScriptRef): Uint8Array => data.bytes

/**
 * Encode ScriptRef to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (data: ScriptRef): string => Bytes.toHex(data.bytes)

/**
 * Encode ScriptRef to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: ScriptRef, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode ScriptRef to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: ScriptRef, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
