import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as RewardAccount from "./RewardAccount.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Helper function for content-based Map equality using Equal.equals.
 *
 * @since 2.0.0
 * @category equality
 */
const mapEquals = <K, V>(a: Map<K, V>, b: Map<K, V>): boolean => {
  if (a.size !== b.size) return false
  for (const [aKey, aValue] of a.entries()) {
    let found = false
    for (const [bKey, bValue] of b.entries()) {
      if (Equal.equals(aKey, bKey) && Equal.equals(aValue, bValue)) {
        found = true
        break
      }
    }
    if (!found) return false
  }
  return true
}

/**
 * Helper function for content-based Map hashing.
 * Computes hash by XORing hashes of all entries for order-independence.
 *
 * @since 2.0.0
 * @category hashing
 */
const mapHash = <K, V>(map: Map<K, V>): number => {
  let hash = Hash.hash(map.size)
  for (const [key, value] of map.entries()) {
    hash ^= Hash.hash(key) ^ Hash.hash(value)
  }
  return hash
}

/**
 * Schema for Withdrawals representing a map of reward accounts to coin amounts.
 *
 * ```
 * withdrawals = {+ reward_account => coin}
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class Withdrawals extends Schema.TaggedClass<Withdrawals>()("Withdrawals", {
  withdrawals: Schema.Map({
    key: RewardAccount.FromBech32,
    value: Coin.Coin
  })
}) {
  toJSON() {
    const obj: Record<string, string> = {}
    for (const [account, coin] of this.withdrawals.entries()) {
      obj[account.toString()] = coin.toString()
    }
    return {
      _tag: "Withdrawals" as const,
      withdrawals: obj
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof Withdrawals && mapEquals(this.withdrawals, that.withdrawals)
  }

  /**
   * Content-based hash for optimization of Equal.equals.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, mapHash(this.withdrawals))
  }
}

/**
 * Check if the given value is a valid Withdrawals
 *
 * @since 2.0.0
 * @category predicates
 */
export const isWithdrawals = Schema.is(Withdrawals)

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Withdrawals): void => {
  w.writeMapHeader(v.withdrawals.size)
  for (const [rewardAccount, coin] of v.withdrawals.entries()) {
    RewardAccount.write(w, rewardAccount)
    w.writeUint(coin)
  }
  w.writeMapBreak()
}

export const read = (r: CborReader): Withdrawals => {
  const count = r.readMapHeader()
  const map = new Map<RewardAccount.RewardAccount, Coin.Coin>()
  if (count === -1) {
    while (!r.isBreak()) {
      const rewardAccount = RewardAccount.read(r)
      const coin = r.readUint()
      map.set(rewardAccount, coin)
    }
  } else {
    for (let i = 0; i < count; i++) {
      const rewardAccount = RewardAccount.read(r)
      const coin = r.readUint()
      map.set(rewardAccount, coin)
    }
  }
  return new Withdrawals({ withdrawals: map })
}
/**
 * CDDL schema for Withdrawals.
 *
 * ```
 * withdrawals = {+ reward_account => coin}
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
/**
 * CBOR bytes transformation schema for Withdrawals.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Withdrawals),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Withdrawals.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Withdrawals.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Withdrawals.FromCBORHex" })

/**
 * FastCheck arbitrary for Withdrawals instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.array(FastCheck.tuple(RewardAccount.arbitrary, Coin.arbitrary), {
  minLength: 0,
  maxLength: 10
}).map((entries) => new Withdrawals({ withdrawals: new Map(entries) }))

/**
 * Create an empty Withdrawals instance.
 *
 * @since 2.0.0
 * @category constructors
 */
export const empty = (): Withdrawals => new Withdrawals({ withdrawals: new Map() })

/**
 * Create a Withdrawals instance with a single withdrawal.
 *
 * @since 2.0.0
 * @category constructors
 */
export const singleton = (rewardAccount: RewardAccount.RewardAccount, coin: Coin.Coin): Withdrawals =>
  new Withdrawals({ withdrawals: new Map([[rewardAccount, coin]]) })

/**
 * Create a Withdrawals instance from an array of [RewardAccount, Coin] pairs.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromEntries = (entries: Array<[RewardAccount.RewardAccount, Coin.Coin]>): Withdrawals =>
  new Withdrawals({ withdrawals: new Map(entries) })

/**
 * Add a withdrawal to existing Withdrawals.
 *
 * @since 2.0.0
 * @category transformation
 */
export const add = (
  withdrawals: Withdrawals,
  rewardAccount: RewardAccount.RewardAccount,
  coin: Coin.Coin
): Withdrawals => {
  const newMap = new Map(withdrawals.withdrawals)
  newMap.set(rewardAccount, coin)
  return new Withdrawals({ withdrawals: newMap })
}

/**
 * Remove a withdrawal from existing Withdrawals.
 *
 * @since 2.0.0
 * @category transformation
 */
export const remove = (withdrawals: Withdrawals, rewardAccount: RewardAccount.RewardAccount): Withdrawals => {
  const newMap = new Map(withdrawals.withdrawals)
  newMap.delete(rewardAccount)
  return new Withdrawals({ withdrawals: newMap })
}

/**
 * Get the coin amount for a specific reward account.
 *
 * @since 2.0.0
 * @category transformation
 */
export const get = (withdrawals: Withdrawals, rewardAccount: RewardAccount.RewardAccount): Coin.Coin | undefined =>
  withdrawals.withdrawals.get(rewardAccount)

/**
 * Check if Withdrawals contains a specific reward account.
 *
 * @since 2.0.0
 * @category predicates
 */
export const has = (withdrawals: Withdrawals, rewardAccount: RewardAccount.RewardAccount): boolean =>
  withdrawals.withdrawals.has(rewardAccount)

/**
 * Check if Withdrawals is empty.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isEmpty = (withdrawals: Withdrawals): boolean => withdrawals.withdrawals.size === 0

/**
 * Get the size (number of withdrawals) in Withdrawals.
 *
 * @since 2.0.0
 * @category transformation
 */
export const size = (withdrawals: Withdrawals): number => withdrawals.withdrawals.size

/**
 * Get all entries as an array of [reward account, coin] pairs.
 *
 * @since 2.0.0
 * @category transformation
 */
export const entries = (withdrawals: Withdrawals): Array<[RewardAccount.RewardAccount, Coin.Coin]> =>
  Array.from(withdrawals.withdrawals.entries())

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a Withdrawals from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a Withdrawals from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a Withdrawals to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: Withdrawals, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert a Withdrawals to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: Withdrawals, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))
