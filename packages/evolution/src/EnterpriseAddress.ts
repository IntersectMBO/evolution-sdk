import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Credential from "./Credential.js"
import * as KeyHash from "./KeyHash.js"
import * as NetworkId from "./NetworkId.js"
import * as ScriptHash from "./ScriptHash.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Enterprise address with only payment credential
 *
 * @since 2.0.0
 * @category schemas
 */
export class EnterpriseAddress extends Schema.TaggedClass<EnterpriseAddress>("EnterpriseAddress")("EnterpriseAddress", {
  networkId: NetworkId.NetworkId,
  paymentCredential: Credential.Credential
}) {
  toJSON() {
    return {
      _tag: "EnterpriseAddress" as const,
      networkId: this.networkId,
      paymentCredential: this.paymentCredential
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
      that instanceof EnterpriseAddress &&
      Equal.equals(this.networkId, that.networkId) &&
      Equal.equals(this.paymentCredential, that.paymentCredential)
    )
  }

  [Hash.symbol](): number {
    return Hash.combine(Hash.hash(this.networkId))(Hash.hash(this.paymentCredential))
  }
}

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(EnterpriseAddress),
  {
    strict: true,
    encode: (_, __, ___, toA) => {
      const paymentBit = toA.paymentCredential._tag === "KeyHash" ? 0 : 1
      const header = (0b01 << 6) | (0b1 << 5) | (paymentBit << 4) | (toA.networkId & 0b00001111)

      const result = new Uint8Array(29)
      result[0] = header

      const paymentCredentialBytes = toA.paymentCredential.hash
      result.set(paymentCredentialBytes, 1)

      return ParseResult.succeed(result)
    },
    decode: (fromA, _, ast) => ParseResult.try({
      try: () => {
        const header = fromA[0]
        // Extract network ID from the lower 4 bits
        const networkId = header & 0b00001111
        // Extract address type from the upper 4 bits (bits 4-7)
        const addressType = header >> 4

        // Script payment
        const isPaymentKey = (addressType & 0b0001) === 0
        const paymentCredential: Credential.Credential = isPaymentKey
          ? new KeyHash.KeyHash({
              hash: fromA.slice(1, 29)
            })
          : new ScriptHash.ScriptHash({
              hash: fromA.slice(1, 29)
            })
        return EnterpriseAddress.make({
          networkId,
          paymentCredential
        })
      },
      catch: (e) => new ParseResult.Type(ast, fromA, e instanceof Error ? e.message : String(e))
    })
  }
).annotations({
  identifier: "EnterpriseAddress.FromBytes",
  description: "Transforms raw bytes to EnterpriseAddress"
})

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex, // string → Uint8Array
  FromBytes // Uint8Array → EnterpriseAddress
).annotations({
  identifier: "EnterpriseAddress.FromHex",
  description: "Transforms raw hex string to EnterpriseAddress"
})

/**
 * FastCheck arbitrary for generating random EnterpriseAddress instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.tuple(NetworkId.arbitrary, Credential.arbitrary).map(
  ([networkId, paymentCredential]) => new EnterpriseAddress({ networkId, paymentCredential })
)

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a EnterpriseAddress from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = (bytes: Uint8Array) => Schema.decodeSync(FromBytes)(bytes)

/**
 * Parse a EnterpriseAddress from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = (hex: string) => Schema.decodeSync(FromHex)(hex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a EnterpriseAddress to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (data: EnterpriseAddress): Uint8Array => {
  const paymentBit = data.paymentCredential._tag === "KeyHash" ? 0 : 1
  const header = (0b01 << 6) | (0b1 << 5) | (paymentBit << 4) | (data.networkId & 0b00001111)
  const result = new Uint8Array(29)
  result[0] = header
  result.set(data.paymentCredential.hash, 1)
  return result
}

/**
 * Convert a EnterpriseAddress to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (data: EnterpriseAddress): string => Bytes.toHex(toBytes(data))

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: EnterpriseAddress): void => w.writeBytes(toBytes(v))

export const read = (r: CborReader): EnterpriseAddress => {
  const bytes = r.readBytesView()
  const header = bytes[0]
  const networkId = header & 0b00001111
  const addressType = header >> 4
  const isPaymentKey = (addressType & 0b0001) === 0
  const paymentCredential: Credential.Credential = isPaymentKey
    ? new KeyHash.KeyHash({ hash: bytes.slice(1, 29) })
    : new ScriptHash.ScriptHash({ hash: bytes.slice(1, 29) })
  return new EnterpriseAddress({ networkId, paymentCredential })
}
