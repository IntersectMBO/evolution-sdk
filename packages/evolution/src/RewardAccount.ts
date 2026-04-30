import { bech32 } from "@scure/base"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Credential from "./Credential.js"
import * as KeyHash from "./KeyHash.js"
import * as NetworkId from "./NetworkId.js"
import * as ScriptHash from "./ScriptHash.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Reward/stake address with only staking credential
 *
 * @since 2.0.0
 * @category schemas
 */
export class RewardAccount extends Schema.TaggedClass<RewardAccount>("RewardAccount")("RewardAccount", {
  networkId: NetworkId.NetworkId,
  stakeCredential: Credential.Credential
}) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return { _tag: "RewardAccount" as const, networkId: this.networkId, stakeCredential: this.stakeCredential }
  }

  /**
   * @since 2.0.0
   * @category string
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * @since 2.0.0
   * @category inspect
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof RewardAccount &&
      Equal.equals(this.networkId, that.networkId) &&
      Equal.equals(this.stakeCredential, that.stakeCredential)
    )
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.combine(Hash.hash(this.networkId))(Hash.hash(this.stakeCredential))
  }
}

export const FromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(RewardAccount),
  {
    strict: true,
    encode: (_, __, ___, toA) => {
      const stakingBit = toA.stakeCredential._tag === "KeyHash" ? 0 : 1
      const header = (0b111 << 5) | (stakingBit << 4) | (toA.networkId & 0b00001111)
      const result = new Uint8Array(29)
      result[0] = header
      const stakeCredentialBytes = toA.stakeCredential.hash
      result.set(stakeCredentialBytes, 1)
      return ParseResult.succeed(result)
    },
    decode: (fromA, _, ast) => ParseResult.try({
      try: () => {
        const header = fromA[0]
        // Extract network ID from the lower 4 bits
        const networkId = header & 0b00001111
        // Extract address type from the upper 4 bits (bits 4-7)
        const addressType = header >> 4

        const isStakeKey = (addressType & 0b0001) === 0
        const stakeCredential: Credential.Credential = isStakeKey
          ? new KeyHash.KeyHash({
              hash: fromA.slice(1, 29)
            })
          : new ScriptHash.ScriptHash({
              hash: fromA.slice(1, 29)
            })
        return RewardAccount.make({
          networkId,
          stakeCredential
        })
      },
      catch: (e) => new ParseResult.Type(ast, fromA, e instanceof Error ? e.message : String(e))
    })
  }
).annotations({
  identifier: "RewardAccount.FromBytes",
  description: "Transforms raw bytes to RewardAccount"
})

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex, // string → Uint8Array
  FromBytes // Uint8Array → RewardAccount
).annotations({
  identifier: "RewardAccount.FromHex",
  description: "Transforms raw hex string to RewardAccount"
})

export const FromBech32 = Schema.transformOrFail(Schema.String, Schema.typeSchema(RewardAccount), {
  strict: true,
  encode: (_, __, ___, toA) => {
    const prefix = toA.networkId === 0 ? "stake_test" : "stake"
    const bytes = toBytes(toA)
    const words = bech32.toWords(bytes)
    return ParseResult.succeed(bech32.encode(prefix, words, false))
  },
  decode: (fromA, _, ast) =>
    ParseResult.try({
      try: () => {
        const decoded = bech32.decode(fromA as `${string}1${string}`, false)
        const bytes = bech32.fromWords(decoded.words)
        return fromBytes(new Uint8Array(bytes))
      },
      catch: (e) => new ParseResult.Type(ast, fromA, e instanceof Error ? e.message : `Failed to decode Bech32: ${fromA}`)
    })
}).annotations({
  identifier: "RewardAccount.FromBech32",
  description: "Transforms Bech32 string to RewardAccount"
})

/**
 * FastCheck arbitrary for RewardAccount instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.tuple(NetworkId.arbitrary, Credential.arbitrary).map(
  ([networkId, stakeCredential]) =>
    new RewardAccount({
      networkId,
      stakeCredential
    })
)

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a RewardAccount from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = (bytes: Uint8Array) => Schema.decodeSync(FromBytes)(bytes)

/**
 * Parse a RewardAccount from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = (hex: string) => Schema.decodeSync(FromHex)(hex)

/**
 * Parse a RewardAccount from Bech32 string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBech32 = (str: string) => Schema.decodeSync(FromBech32)(str)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a RewardAccount to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (data: RewardAccount): Uint8Array => {
  const stakingBit = data.stakeCredential._tag === "KeyHash" ? 0 : 1
  const header = (0b111 << 5) | (stakingBit << 4) | (data.networkId & 0b00001111)
  const result = new Uint8Array(29)
  result[0] = header
  result.set(data.stakeCredential.hash, 1)
  return result
}

/**
 * Convert a RewardAccount to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (data: RewardAccount): string => Bytes.toHex(toBytes(data))

/**
 * Convert a RewardAccount to Bech32 string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBech32 = (data: RewardAccount) => Schema.encodeSync(FromBech32)(data)

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: RewardAccount): void => w.writeBytes(toBytes(v))

export const read = (r: CborReader): RewardAccount => {
  const bytes = r.readBytesView()
  const header = bytes[0]
  const networkId = header & 0b00001111
  const addressType = header >> 4
  const isStakeKey = (addressType & 0b0001) === 0
  const stakeCredential: Credential.Credential = isStakeKey
    ? new KeyHash.KeyHash({ hash: bytes.slice(1, 29) })
    : new ScriptHash.ScriptHash({ hash: bytes.slice(1, 29) })
  return new RewardAccount({ networkId, stakeCredential })
}
