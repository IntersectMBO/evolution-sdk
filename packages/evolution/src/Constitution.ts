import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Anchor from "./Anchor.js"
import * as Bytes from "./Bytes.js"
import * as ScriptHash from "./ScriptHash.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Constitution per CDDL:
 * constitution = [anchor, script_hash/ nil]
 *
 * @since 2.0.0
 * @category schemas
 */
export class Constitution extends Schema.TaggedClass<Constitution>()("Constitution", {
  anchor: Anchor.Anchor,
  scriptHash: Schema.NullOr(ScriptHash.ScriptHash)
}) {
  toJSON() {
    return {
      _tag: "Constitution" as const,
      anchor: this.anchor.toJSON(),
      scriptHash: this.scriptHash ? this.scriptHash.toJSON() : null
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
      that instanceof Constitution &&
      Equal.equals(this.anchor, that.anchor) &&
      Equal.equals(this.scriptHash, that.scriptHash)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("Constitution"))(Hash.combine(Hash.hash(this.anchor))(Hash.hash(this.scriptHash)))
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Constitution): void => {
  w.writeArrayHeader(2)
  Anchor.write(w, v.anchor)
  if (v.scriptHash) ScriptHash.write(w, v.scriptHash)
  else w.writeNull()
  w.writeArrayBreak()
}

export const read = (r: CborReader): Constitution => {
  const count = r.readArrayHeader()
  const anchor = Anchor.read(r)
  const scriptHash = r.peekByte() === 0xf6 ? (r.readNull(), null) : ScriptHash.read(r)
  if (count === -1) r.isBreak()
  return new Constitution({ anchor, scriptHash })
}
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Constitution),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Constitution.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Constitution.FromCBORHex" })

/**
 * Arbitrary for Constitution
 */
export const arbitrary: FastCheck.Arbitrary<Constitution> = FastCheck.tuple(
  Anchor.arbitrary,
  FastCheck.option(ScriptHash.arbitrary, { nil: null })
).map(([anchor, scriptHash]) => new Constitution({ anchor, scriptHash }, { disableValidation: true }))

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Parse Constitution from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse Constitution from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert Constitution to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (constitution: Constitution, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, constitution)
  return w.finishView()
}

/**
 * Convert Constitution to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (constitution: Constitution, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(constitution, profile))
