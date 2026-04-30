import { FastCheck, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as MultiHostName from "./MultiHostName.js"
import * as SingleHostAddr from "./SingleHostAddr.js"
import * as SingleHostName from "./SingleHostName.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Union schema for Relay representing various relay configurations.
 * relay = [ single_host_addr // single_host_name // multi_host_name ]
 *
 * @since 2.0.0
 * @category schemas
 */
export const Relay = Schema.Union(
  SingleHostAddr.SingleHostAddr,
  SingleHostName.SingleHostName,
  MultiHostName.MultiHostName
)
/**
 * Type alias for Relay.
 *
 * @since 2.0.0
 * @category model
 */
export type Relay = typeof Relay.Type

// ============================================================================
// Write / Read — Relay
// ============================================================================

export const write = (w: CborWriter, v: Relay): void => {
  switch (v._tag) {
    case "SingleHostAddr": SingleHostAddr.write(w, v); break
    case "SingleHostName": SingleHostName.write(w, v); break
    case "MultiHostName": MultiHostName.write(w, v); break
  }
}

export const read = (r: CborReader): Relay => {
  // Peek at the tag byte (first element of the array) to determine type
  const saved = r.offset
  r.readArrayHeader()
  const tag = r.readUint()
  // Reset offset to beginning so child readers consume the full array
  r.offset = saved
  switch (tag) {
    case 0n: return SingleHostAddr.read(r)
    case 1n: return SingleHostName.read(r)
    case 2n: return MultiHostName.read(r)
    default: throw new Error(`Unknown Relay tag: ${tag}`)
  }
}

/**
 * CBOR bytes transformation schema for Relay.
 * For union types, we create a union of the child CBOR schemas.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Relay),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Relay.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Relay.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Relay.FromCBORHex" })

/**
 * @since 2.0.0
 * @category FastCheck
 */
export const arbitrary = FastCheck.oneof(SingleHostAddr.arbitrary, SingleHostName.arbitrary, MultiHostName.arbitrary)

/**
 * Create a Relay from a SingleHostAddr.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromSingleHostAddr = (singleHostAddr: SingleHostAddr.SingleHostAddr): Relay => singleHostAddr

/**
 * Create a Relay from a SingleHostName.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromSingleHostName = (singleHostName: SingleHostName.SingleHostName): Relay => singleHostName

/**
 * Create a Relay from a MultiHostName.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromMultiHostName = (multiHostName: MultiHostName.MultiHostName): Relay => multiHostName

/**
 * Parse Relay from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse Relay from CBOR hex.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert Relay to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: Relay, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(64, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert Relay to CBOR hex.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: Relay, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Pattern match on a Relay to handle different relay types.
 *
 * @since 2.0.0
 * @category transformation
 */
export const match = <A, B, C>(
  relay: Relay,
  cases: {
    SingleHostAddr: (addr: SingleHostAddr.SingleHostAddr) => A
    SingleHostName: (name: SingleHostName.SingleHostName) => B
    MultiHostName: (multi: MultiHostName.MultiHostName) => C
  }
): A | B | C => {
  switch (relay._tag) {
    case "SingleHostAddr":
      return cases.SingleHostAddr(relay)
    case "SingleHostName":
      return cases.SingleHostName(relay)
    case "MultiHostName":
      return cases.MultiHostName(relay)
    default:
      throw new Error(`Exhaustive check failed: Unhandled case '${(relay as { _tag: string })._tag}' encountered.`)
  }
}

/**
 * Check if a Relay is a SingleHostAddr.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isSingleHostAddr = (relay: Relay): relay is SingleHostAddr.SingleHostAddr =>
  relay._tag === "SingleHostAddr"

/**
 * Check if a Relay is a SingleHostName.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isSingleHostName = (relay: Relay): relay is SingleHostName.SingleHostName =>
  relay._tag === "SingleHostName"

/**
 * Check if a Relay is a MultiHostName.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isMultiHostName = (relay: Relay): relay is MultiHostName.MultiHostName => relay._tag === "MultiHostName"
