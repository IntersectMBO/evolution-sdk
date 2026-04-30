/**
 * Header module based on Conway CDDL specification
 *
 * CDDL: header = [header_body, body_signature : kes_signature]
 *
 * @since 2.0.0
 */
import { Equal, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as HeaderBody from "./HeaderBody.js"
import * as KesSignature from "./KesSignature.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Header implementation using HeaderBody and KesSignature
 *
 * CDDL: header = [header_body, body_signature : kes_signature]
 *
 * @since 2.0.0
 * @category model
 */
export class Header extends Schema.TaggedClass<Header>()("Header", {
  headerBody: HeaderBody.HeaderBody,
  bodySignature: KesSignature.KesSignature
}) {
  toJSON() {
    return {
      _tag: "Header" as const,
      headerBody: this.headerBody.toJSON(),
      bodySignature: this.bodySignature.toJSON()
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
      that instanceof Header &&
      Equal.equals(this.headerBody, that.headerBody) &&
      Equal.equals(this.bodySignature, that.bodySignature)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.headerBody))(Hash.hash(this.bodySignature)))
  }
}

/**
 * Predicate to check if a value is a Header instance.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isHeader = (value: unknown): value is Header => value instanceof Header

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Header): void => {
  w.writeArrayHeader(2)
  HeaderBody.write(w, v.headerBody)
  KesSignature.write(w, v.bodySignature)
  w.writeArrayBreak()
}

export const read = (r: CborReader): Header => {
  const count = r.readArrayHeader()
  const headerBody = HeaderBody.read(r)
  const bodySignature = KesSignature.read(r)
  if (count === -1) r.isBreak()
  return new Header({ headerBody, bodySignature })
}

/**
 * CBOR bytes transformation schema for Header.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Header),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Header.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Header.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Header.FromCBORHex" })

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse a Header from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a Header from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a Header to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (header: Header, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, header)
  return w.finish()
}

/**
 * Convert a Header to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (header: Header, profile?: EncodingProfile): string => {
  const bytes = toCBORBytes(header, profile)
  return Schema.encodeSync(Schema.Uint8ArrayFromHex)(bytes)
}
