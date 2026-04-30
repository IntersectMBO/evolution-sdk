import { Equal, FastCheck, Function, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * ProtocolVersion class based on Conway CDDL specification
 *
 * CDDL: protocol_version = [major_version : uint32, minor_version : uint32]
 *
 * @since 2.0.0
 * @category model
 */
export class ProtocolVersion extends Schema.TaggedClass<ProtocolVersion>()("ProtocolVersion", {
  major: Numeric.Uint32Schema,
  minor: Numeric.Uint32Schema
}) {
  toJSON() {
    return { _tag: "ProtocolVersion" as const, major: this.major, minor: this.minor }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof ProtocolVersion && this.major === that.major && this.minor === that.minor
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.number(Number(this.major)))(Hash.number(Number(this.minor))))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: ProtocolVersion): void => {
  w.writeArrayHeader(2)
  w.writeUint(v.major)
  w.writeUint(v.minor)
  w.writeArrayBreak()
}

export const read = (r: CborReader): ProtocolVersion => {
  const start = r.position()
  const count = r.readArrayHeader()
  const pv = new ProtocolVersion({
    major: r.readUint(),
    minor: r.readUint()
  })
  if (count === -1) r.isBreak()
  capture(pv, r.buffer().subarray(start, r.position()))
  return pv
}

/**
 * FastCheck arbitrary for generating random ProtocolVersion instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.tuple(Numeric.Uint32Arbitrary, Numeric.Uint32Arbitrary).map(
  ([major, minor]) => new ProtocolVersion({ major, minor })
)

/**
 * CBOR bytes transformation schema for ProtocolVersion.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(ProtocolVersion),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "ProtocolVersion.FromCBORBytes" })

/**
 * CBOR hex transformation schema for ProtocolVersion.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "ProtocolVersion.FromCBORHex" })

/**
 * Convert CBOR bytes to ProtocolVersion (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to ProtocolVersion (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert ProtocolVersion to CBOR bytes (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORBytes: {
  (profile?: EncodingProfile): (version: ProtocolVersion) => Uint8Array
  (version: ProtocolVersion, profile?: EncodingProfile): Uint8Array
} = Function.dual(
  (args) => args.length >= 1 && args[0] instanceof ProtocolVersion,
  (version: ProtocolVersion, profile?: EncodingProfile): Uint8Array => {
    const w = new CborWriter(64, profile)
    write(w, version)
    return w.finishView()
  }
)

/**
 * Convert ProtocolVersion to CBOR hex string (unsafe)
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORHex: {
  (profile?: EncodingProfile): (version: ProtocolVersion) => string
  (version: ProtocolVersion, profile?: EncodingProfile): string
} = Function.dual(
  (args) => args.length >= 1 && args[0] instanceof ProtocolVersion,
  (version: ProtocolVersion, profile?: EncodingProfile): string =>
    Bytes.toHex(toCBORBytes(version, profile))
)
