import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as DnsName from "./DnsName.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for MultiHostName representing a multiple host name record.
 * multi_host_name = (2, dns_name)
 *
 * @since 2.0.0
 * @category model
 */
export class MultiHostName extends Schema.TaggedClass<MultiHostName>()("MultiHostName", {
  dnsName: DnsName.DnsName
}) {
  /**
   * Convert to JSON-serializable format.
   *
   * @since 2.0.0
   * @category serialization
   */
  toJSON() {
    return {
      _tag: "MultiHostName" as const,
      dnsName: this.dnsName
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof MultiHostName && Equal.equals(this.dnsName, that.dnsName)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.dnsName))
  }

  /**
   * Convert to CBOR bytes.
   *
   * @since 2.0.0
   * @category serialization
   */
  toCBORBytes(): Uint8Array {
    return toCBORBytes(this)
  }

  /**
   * Convert to CBOR hex string.
   *
   * @since 2.0.0
   * @category serialization
   */
  toCBORHex(): string {
    return toCBORHex(this)
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: MultiHostName): void => {
  w.writeArrayHeader(2)
  w.writeUint(2n)
  w.writeText(v.dnsName)
  w.writeArrayBreak()
}

export const read = (r: CborReader): MultiHostName => {
  const count = r.readArrayHeader()
  r.readUint() // tag = 2
  const dnsName = r.readText() as DnsName.DnsName
  if (count === -1) r.isBreak()
  return new MultiHostName({ dnsName })
}

/**
 * CBOR bytes transformation schema for MultiHostName.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(MultiHostName),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "MultiHostName.FromCBORBytes" })

/**
 * CBOR hex transformation schema for MultiHostName.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "MultiHostName.FromCBORHex" })

/**
 * FastCheck arbitrary for MultiHostName instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.record({
  dnsName: DnsName.arbitrary
}).map((props) => new MultiHostName(props))

/**
 * Parse MultiHostName from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse MultiHostName from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode MultiHostName to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: MultiHostName, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode MultiHostName to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: MultiHostName, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
