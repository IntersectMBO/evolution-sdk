import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as IPv4 from "./IPv4.js"
import * as IPv6 from "./IPv6.js"
import * as Port from "./Port.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for SingleHostAddr representing a network host with IP addresses.
 * single_host_addr = (0, port/ nil, ipv4/ nil, ipv6/ nil)
 *
 * @since 2.0.0
 * @category model
 */
export class SingleHostAddr extends Schema.TaggedClass<SingleHostAddr>()("SingleHostAddr", {
  port: Schema.optional(Port.PortSchema),
  ipv4: Schema.optional(IPv4.IPv4),
  ipv6: Schema.optional(IPv6.IPv6)
}) {
  /**
   * Convert to JSON-serializable format.
   * Converts bigint port values to strings for JSON compatibility.
   *
   * @since 2.0.0
   * @category serialization
   */
  toJSON() {
    return {
      _tag: "SingleHostAddr" as const,
      port: this.port !== undefined ? String(this.port) : null,
      ipv4: this.ipv4 !== undefined ? this.ipv4.toJSON() : null,
      ipv6: this.ipv6 !== undefined ? this.ipv6.toJSON() : null
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
      that instanceof SingleHostAddr &&
      this.port === that.port &&
      ((this.ipv4 === undefined && that.ipv4 === undefined) ||
        (this.ipv4 !== undefined && that.ipv4 !== undefined && Equal.equals(this.ipv4, that.ipv4))) &&
      ((this.ipv6 === undefined && that.ipv6 === undefined) ||
        (this.ipv6 !== undefined && that.ipv6 !== undefined && Equal.equals(this.ipv6, that.ipv6)))
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash(this.port))(
        Hash.combine(this.ipv4 !== undefined ? Hash.hash(this.ipv4) : Hash.hash(undefined))(
          this.ipv6 !== undefined ? Hash.hash(this.ipv6) : Hash.hash(undefined)
        )
      )
    )
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

/**
 * Create a SingleHostAddr with IPv4 address.
 *
 * @since 2.0.0
 * @category constructors
 */
export const withIPv4 = (port: Port.Port, ipv4: IPv4.IPv4): SingleHostAddr =>
  new SingleHostAddr({
    port,
    ipv4
  })

/**
 * Create a SingleHostAddr with IPv6 address.
 *
 * @since 2.0.0
 * @category constructors
 */
export const withIPv6 = (port: Port.Port, ipv6: IPv6.IPv6): SingleHostAddr =>
  new SingleHostAddr({
    port,
    ipv6
  })

/**
 * Create a SingleHostAddr with both IPv4 and IPv6 addresses.
 *
 * @since 2.0.0
 * @category constructors
 */
export const withBothIPs = (port: Port.Port, ipv4: IPv4.IPv4, ipv6: IPv6.IPv6): SingleHostAddr =>
  new SingleHostAddr({
    port,
    ipv4,
    ipv6
  })

/**
 * Check if the host address has an IPv4 address.
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasIPv4 = (hostAddr: SingleHostAddr): boolean => hostAddr.ipv4 !== undefined

/**
 * Check if the host address has an IPv6 address.
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasIPv6 = (hostAddr: SingleHostAddr): boolean => hostAddr.ipv6 !== undefined

/**
 * Check if the host address has a port.
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasPort = (hostAddr: SingleHostAddr): boolean => hostAddr.port !== undefined

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: SingleHostAddr): void => {
  w.writeArrayHeader(4)
  w.writeUint(0n)
  if (v.port !== undefined) w.writeUint(v.port)
  else w.writeNull()
  if (v.ipv4 !== undefined) IPv4.write(w, v.ipv4)
  else w.writeNull()
  if (v.ipv6 !== undefined) IPv6.write(w, v.ipv6)
  else w.writeNull()
  w.writeArrayBreak()
}

export const read = (r: CborReader): SingleHostAddr => {
  const count = r.readArrayHeader()
  r.readUint() // tag = 0
  const port = r.peekByte() === 0xf6 ? (r.readNull(), undefined) : r.readUint() as Port.Port
  const ipv4 = r.peekByte() === 0xf6 ? (r.readNull(), undefined) : IPv4.read(r)
  const ipv6 = r.peekByte() === 0xf6 ? (r.readNull(), undefined) : IPv6.read(r)
  if (count === -1) r.isBreak()
  return new SingleHostAddr({ port, ipv4, ipv6 }, { disableValidation: true })
}

/**
 * FastCheck arbitrary for generating random SingleHostAddr instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.record({
  port: FastCheck.option(Port.arbitrary),
  ipv4: FastCheck.option(IPv4.arbitrary),
  ipv6: FastCheck.option(IPv6.arbitrary)
}).map(
  ({ ipv4, ipv6, port }) =>
    new SingleHostAddr({
      port: port === null ? undefined : port,
      ipv4: ipv4 === null ? undefined : ipv4,
      ipv6: ipv6 === null ? undefined : ipv6
    })
)

/**
 * CBOR bytes transformation schema for SingleHostAddr.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(SingleHostAddr),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "SingleHostAddr.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "SingleHostAddr.FromCBORHex" })

/**
 * Parse SingleHostAddr from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse SingleHostAddr from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode SingleHostAddr to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: SingleHostAddr, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode SingleHostAddr to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: SingleHostAddr, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
