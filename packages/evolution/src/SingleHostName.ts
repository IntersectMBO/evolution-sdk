import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as DnsName from "./DnsName.js"
import * as Port from "./Port.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for SingleHostName representing a network host with DNS name.
 * single_host_name = (1, port/ nil, dns_name)
 *
 * Used for A or AAAA DNS records.
 *
 * @since 2.0.0
 * @category model
 */
export class SingleHostName extends Schema.TaggedClass<SingleHostName>()("SingleHostName", {
  port: Schema.optional(Port.PortSchema),
  dnsName: DnsName.DnsName
}) {
  /**
   * Convert to JSON-serializable format.
   * Relies on Option's built-in toJSON() for port serialization.
   * Converts bigint port values to strings for JSON compatibility.
   *
   * @since 2.0.0
   * @category serialization
   */
  toJSON() {
    return {
      _tag: "SingleHostName" as const,
      port: this.port !== undefined ? String(this.port) : null,
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
    return that instanceof SingleHostName && this.port === that.port && Equal.equals(this.dnsName, that.dnsName)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.port))(Hash.hash(this.dnsName)))
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

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return {
      _tag: "SingleHostName",
      port: this.port,
      dnsName: this.dnsName
    }
  }
}

/**
 * Create a SingleHostName with a port.
 *
 * @since 2.0.0
 * @category constructors
 */
export const withPort = (port: Port.Port, dnsName: DnsName.DnsName): SingleHostName =>
  new SingleHostName({
    port,
    dnsName
  })

/**
 * Create a SingleHostName without a port.
 *
 * @since 2.0.0
 * @category constructors
 */
export const withoutPort = (dnsName: DnsName.DnsName): SingleHostName =>
  new SingleHostName({
    dnsName
  })

/**
 * Check if the host name has a port.
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasPort = (hostName: SingleHostName): boolean => hostName.port !== undefined

/**
 * Get the DNS name from a SingleHostName.
 *
 * @since 2.0.0
 * @category transformation
 */
export const getDnsName = (hostName: SingleHostName): DnsName.DnsName => hostName.dnsName

/**
 * Get the port from a SingleHostName, if it exists.
 *
 * @since 2.0.0
 * @category transformation
 */
export const getPort = (hostName: SingleHostName): Port.Port | undefined => hostName.port

/**
 * Generate a random SingleHostName.
 *
 * @since 2.0.0
 * @category generators
 */
export const generator = FastCheck.record({
  port: FastCheck.option(Port.arbitrary),
  dnsName: DnsName.arbitrary
}).map(
  ({ dnsName, port }) =>
    new SingleHostName({
      port: port === null ? undefined : port,
      dnsName
    })
)

/**
 * FastCheck arbitrary for SingleHostName instances.
 * Alias to `generator` for consistency with other modules.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = generator

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: SingleHostName): void => {
  w.writeArrayHeader(3)
  w.writeUint(1n)
  if (v.port !== undefined) w.writeUint(v.port)
  else w.writeNull()
  w.writeText(v.dnsName)
  w.writeArrayBreak()
}

export const read = (r: CborReader): SingleHostName => {
  const count = r.readArrayHeader()
  r.readUint() // tag = 1
  const port = r.peekByte() === 0xf6 ? (r.readNull(), undefined) : r.readUint() as Port.Port
  const dnsName = r.readText() as DnsName.DnsName
  if (count === -1) r.isBreak()
  return new SingleHostName({ port, dnsName })
}
/**
 * CBOR bytes transformation schema for SingleHostName.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(SingleHostName),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "SingleHostName.FromCBORBytes" })

/** @deprecated Use FromCBORBytes instead */
export const FromBytes = FromCBORBytes

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "SingleHostName.FromCBORHex" })

/** @deprecated Use FromCBORHex instead */
export const FromHex = FromCBORHex

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse a SingleHostName from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a SingleHostName from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a SingleHostName to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: SingleHostName, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert a SingleHostName to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: SingleHostName, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
