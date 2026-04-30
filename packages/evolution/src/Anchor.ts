import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import * as Url from "./Url.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for Anchor representing an anchor with URL and data hash.
 * ```
 * anchor = [anchor_url: url, anchor_data_hash: Bytes32]
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class Anchor extends Schema.TaggedClass<Anchor>()("Anchor", {
  anchorUrl: Url.Url,
  anchorDataHash: Bytes32.BytesFromHex
}) {
  toJSON() {
    return {
      _tag: "Anchor" as const,
      anchorUrl: this.anchorUrl.href,
      anchorDataHash: Bytes.toHex(this.anchorDataHash)
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
      that instanceof Anchor &&
      Equal.equals(this.anchorUrl, that.anchorUrl) &&
      Bytes.equals(this.anchorDataHash, that.anchorDataHash)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("Anchor"))(
        Hash.combine(Hash.hash(this.anchorUrl))(Hash.array(Array.from(this.anchorDataHash)))
      )
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Anchor): void => {
  w.writeArrayHeader(2)
  Url.write(w, v.anchorUrl)
  w.writeBytes(v.anchorDataHash)
  w.writeArrayBreak()
}

export const read = (r: CborReader): Anchor => {
  const start = r.position()
  const count = r.readArrayHeader()
  const anchor = new Anchor({
    anchorUrl: Url.read(r),
    anchorDataHash: r.readBytesView()
  })
  if (count === -1) r.isBreak()
  capture(anchor, r.buffer().subarray(start, r.position()))
  return anchor
}
/**
 * CBOR bytes transformation schema for Anchor.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Anchor),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Anchor.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Anchor.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Anchor.FromCBORHex" })

/**
 * FastCheck arbitrary for Anchor instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.record({
  anchorUrl: Url.arbitrary,
  anchorDataHash: FastCheck.uint8Array({ minLength: 32, maxLength: 32 })
}).map(({ anchorDataHash, anchorUrl }) => new Anchor({ anchorUrl, anchorDataHash }))

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse an Anchor from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse an Anchor from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert an Anchor to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (anchor: Anchor, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, anchor)
  return w.finishView()
}

/**
 * Convert an Anchor to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (anchor: Anchor, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(anchor, profile))
