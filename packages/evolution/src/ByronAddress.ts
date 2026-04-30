import { Equal, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as NetworkId from "./NetworkId.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Byron legacy address format
 *
 * @since 2.0.0
 * @category schemas
 */
export class ByronAddress extends Schema.TaggedClass<ByronAddress>("ByronAddress")("ByronAddress", {
  networkId: NetworkId.NetworkId,
  bytes: Schema.Uint8ArrayFromSelf
}) {
  toJSON() {
    return {
      _tag: "ByronAddress" as const,
      networkId: this.networkId,
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
    return that instanceof ByronAddress && this.networkId === that.networkId && this.bytes === that.bytes
  }

  [Hash.symbol](): number {
    return Hash.hash(this.toJSON())
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: ByronAddress): void => {
  w.writeBytes(v.bytes)
}

export const read = (r: CborReader): ByronAddress => {
  const bytes = r.readBytes()
  return new ByronAddress({
    networkId: NetworkId.NetworkId.make(0),
    bytes
  })
}

/**
 * Schema for encoding/decoding Byron addresses as bytes.
 *
 * @since 2.0.0
 * @category schemas
 */
export const BytesSchema = Schema.transformOrFail(Schema.Uint8ArrayFromSelf, ByronAddress, {
  strict: true,
  encode: (_, __, ___, toA) => ParseResult.succeed(toA.bytes),
  decode: (_, __, ast, fromA) =>
    ParseResult.try({
      try: () =>
        new ByronAddress({
          networkId: NetworkId.NetworkId.make(0),
          bytes: fromA
        }),
      catch: (e) => new ParseResult.Type(ast, fromA, e instanceof Error ? e.message : String(e))
    })
})

/**
 * Schema for encoding/decoding Byron addresses as hex strings.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromHex = Schema.compose(Schema.Uint8ArrayFromHex, BytesSchema)
