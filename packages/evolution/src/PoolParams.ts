import { BigDecimal, Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as KeyHash from "./KeyHash.js"
import * as MultiHostName from "./MultiHostName.js"
import * as PoolKeyHash from "./PoolKeyHash.js"
import * as PoolMetadata from "./PoolMetadata.js"
import * as Relay from "./Relay.js"
import * as RewardAccount from "./RewardAccount.js"
import * as SingleHostAddr from "./SingleHostAddr.js"
import * as SingleHostName from "./SingleHostName.js"
import * as UnitInterval from "./UnitInterval.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"
import * as VrfKeyHash from "./VrfKeyHash.js"

/**
 * Schema for PoolParams representing stake pool registration parameters.
 *
 * ```
 * pool_params =
 *   ( operator       : pool_keyhash
 *   , vrf_keyhash    : vrf_keyhash
 *   , pledge         : coin
 *   , cost           : coin
 *   , margin         : unit_interval
 *   , reward_account : reward_account
 *   , pool_owners    : set<addr_keyhash>
 *   , relays         : [* relay]
 *   , pool_metadata  : pool_metadata/ nil
 *   )
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class PoolParams extends Schema.TaggedClass<PoolParams>()("PoolParams", {
  operator: PoolKeyHash.PoolKeyHash,
  vrfKeyhash: VrfKeyHash.VrfKeyHash,
  pledge: Coin.Coin,
  cost: Coin.Coin,
  margin: UnitInterval.UnitInterval,
  rewardAccount: RewardAccount.RewardAccount,
  poolOwners: Schema.Array(KeyHash.KeyHash),
  relays: Schema.Array(Relay.Relay),
  poolMetadata: Schema.optionalWith(PoolMetadata.PoolMetadata, {
    nullable: true
  })
}) {
  /**
   * Convert to JSON-serializable object.
   * Converts bigint fields to strings and delegates to contained types' toJSON methods.
   *
   * @since 2.0.0
   * @category encoding
   */
  toJSON() {
    return {
      _tag: "PoolParams" as const,
      operator: this.operator.toJSON(),
      vrfKeyhash: this.vrfKeyhash.toJSON(),
      pledge: String(this.pledge),
      cost: String(this.cost),
      margin: {
        numerator: String(this.margin.numerator),
        denominator: String(this.margin.denominator)
      },
      rewardAccount: this.rewardAccount.toJSON(),
      poolOwners: this.poolOwners.map((owner) => owner.toJSON()),
      relays: this.relays.map((relay) => relay.toJSON()),
      poolMetadata: this.poolMetadata ? this.poolMetadata.toJSON() : null
    }
  }

  /**
   * Encode to CBOR bytes.
   *
   * @since 2.0.0
   * @category encoding
   */
  toCBORBytes(): Uint8Array {
    return toBytes(this)
  }

  /**
   * Encode to CBOR hex string.
   *
   * @since 2.0.0
   * @category encoding
   */
  toCBORHex(): string {
    return toHex(this)
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    if (!(that instanceof PoolParams)) return false

    return (
      Equal.equals(this.operator, that.operator) &&
      Equal.equals(this.vrfKeyhash, that.vrfKeyhash) &&
      this.pledge === that.pledge &&
      this.cost === that.cost &&
      Equal.equals(this.margin, that.margin) &&
      Equal.equals(this.rewardAccount, that.rewardAccount) &&
      this.poolOwners.length === that.poolOwners.length &&
      this.poolOwners.every((owner, i) => Equal.equals(owner, that.poolOwners[i])) &&
      this.relays.length === that.relays.length &&
      this.relays.every((relay, i) => Equal.equals(relay, that.relays[i])) &&
      ((this.poolMetadata === undefined && that.poolMetadata === undefined) ||
        (this.poolMetadata !== undefined &&
          that.poolMetadata !== undefined &&
          Equal.equals(this.poolMetadata, that.poolMetadata)))
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash(this.operator))(
        Hash.combine(Hash.hash(this.vrfKeyhash))(
          Hash.combine(Hash.hash(this.pledge))(
            Hash.combine(Hash.hash(this.cost))(
              Hash.combine(Hash.hash(this.margin))(
                Hash.combine(Hash.hash(this.rewardAccount))(
                  Hash.combine(Hash.array(this.poolOwners.map((o) => Hash.hash(o))))(
                    Hash.combine(Hash.array(this.relays.map((r) => Hash.hash(r))))(Hash.hash(this.poolMetadata))
                  )
                )
              )
            )
          )
        )
      )
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

const writeRelay = (w: CborWriter, v: Relay.Relay): void => {
  switch (v._tag) {
    case "SingleHostAddr": return SingleHostAddr.write(w, v)
    case "SingleHostName": return SingleHostName.write(w, v)
    case "MultiHostName": return MultiHostName.write(w, v)
  }
}

const readRelay = (r: CborReader): Relay.Relay => {
  // Each relay type's read() handles its own array header + tag.
  // Peek at the tag byte (first integer after array header) to dispatch.
  const buf = r.buffer()
  const pos = r.position()
  const firstByte = buf[pos]
  // Array header: 0x80-0x97 = definite 0-23 elements, 0x9f = indefinite
  // The tag integer immediately follows the array header (1 byte for small arrays)
  const tagOffset = (firstByte & 0x1f) < 24 ? pos + 1 : firstByte === 0x9f ? pos + 1 : pos + 2
  const tagByte = buf[tagOffset]
  switch (tagByte) {
    case 0: return SingleHostAddr.read(r)
    case 1: return SingleHostName.read(r)
    case 2: return MultiHostName.read(r)
    default: throw new Error(`Unknown relay tag: ${tagByte}`)
  }
}

export const write = (w: CborWriter, v: PoolParams): void => {
  // pool_params is NOT wrapped in an array header — it's inline fields
  PoolKeyHash.write(w, v.operator)
  VrfKeyHash.write(w, v.vrfKeyhash)
  w.writeUint(v.pledge)
  w.writeUint(v.cost)
  // margin = #6.30([uint, uint])
  w.writeTagHeader(30)
  w.writeArrayHeader(2)
  w.writeUint(v.margin.numerator)
  w.writeUint(v.margin.denominator)
  w.writeArrayBreak()
  RewardAccount.write(w, v.rewardAccount)
  // pool_owners = set<addr_keyhash>
  w.writeArrayHeader(v.poolOwners.length)
  for (const owner of v.poolOwners) KeyHash.write(w, owner)
  w.writeArrayBreak()
  // relays = [* relay]
  w.writeArrayHeader(v.relays.length)
  for (const relay of v.relays) writeRelay(w, relay)
  w.writeArrayBreak()
  // pool_metadata = pool_metadata / nil
  if (v.poolMetadata === undefined || v.poolMetadata === null) { w.writeNull() }
  else { PoolMetadata.write(w, v.poolMetadata) }
}

export const read = (r: CborReader): PoolParams => {
  // pool_params fields are inline (no array header — parent provides it)
  const operator = PoolKeyHash.read(r)
  const vrfKeyhash = VrfKeyHash.read(r)
  const pledge = r.readUint() as Coin.Coin
  const cost = r.readUint() as Coin.Coin
  // margin = #6.30([uint, uint])
  const marginTag = r.readTagHeader()
  if (marginTag !== 30) throw new Error(`PoolParams: expected tag 30 for margin, got ${marginTag}`)
  const marginCount = r.readArrayHeader()
  const numerator = r.readUint()
  const denominator = r.readUint()
  if (marginCount === -1) r.isBreak()
  const margin = new UnitInterval.UnitInterval({ numerator, denominator })
  const rewardAccount = RewardAccount.read(r)
  // pool_owners
  const ownersCount = r.readArrayHeader()
  const poolOwners: Array<KeyHash.KeyHash> = []
  if (ownersCount === -1) { while (!r.isBreak()) poolOwners.push(KeyHash.read(r)) }
  else { for (let i = 0; i < ownersCount; i++) poolOwners.push(KeyHash.read(r)) }
  // relays
  const relaysCount = r.readArrayHeader()
  const relays: Array<Relay.Relay> = []
  if (relaysCount === -1) { while (!r.isBreak()) relays.push(readRelay(r)) }
  else { for (let i = 0; i < relaysCount; i++) relays.push(readRelay(r)) }
  // pool_metadata
  let poolMetadata: PoolMetadata.PoolMetadata | undefined
  if (r.peekMajorType() === 7) { r.readNull() }
  else { poolMetadata = PoolMetadata.read(r) }
  return new PoolParams({
    operator,
    vrfKeyhash,
    pledge,
    cost,
    margin,
    rewardAccount,
    poolOwners,
    relays,
    poolMetadata
  })
}
/**
 * CBOR bytes transformation schema for PoolParams.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(PoolParams),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "PoolParams.FromCBORBytes" })

/**
 * CBOR hex transformation schema for PoolParams.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "PoolParams.FromCBORHex" })

/**
 * Get total effective stake for pool rewards calculation.
 *
 * @since 2.0.0
 * @category transformation
 */
export const getEffectiveStake = (params: PoolParams, totalStake: Coin.Coin): Coin.Coin => {
  // Effective stake is min(totalStake, pledge) for calculation purposes
  return totalStake < params.pledge ? totalStake : params.pledge
}

/**
 * Calculate pool operator rewards based on pool parameters.
 *
 * @since 2.0.0
 * @category transformation
 */
export const calculatePoolRewards = (
  params: PoolParams,
  totalRewards: Coin.Coin
): { operatorRewards: Coin.Coin; delegatorRewards: Coin.Coin } => {
  const fixedCost = params.cost
  const marginDecimal = UnitInterval.toBigDecimal(params.margin)

  if (totalRewards <= fixedCost) {
    return {
      operatorRewards: totalRewards,
      delegatorRewards: 0n
    }
  }

  const rewardsAfterCost = totalRewards - fixedCost
  const marginAsNumber = Number(BigDecimal.unsafeToNumber(marginDecimal))
  const operatorShare = BigInt(Math.floor(Number(rewardsAfterCost) * marginAsNumber))

  return {
    operatorRewards: fixedCost + operatorShare,
    delegatorRewards: rewardsAfterCost - operatorShare
  }
}

/**
 * Check if the pool has the minimum required cost.
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasMinimumCost = (params: PoolParams, minPoolCost: Coin.Coin): boolean => params.cost >= minPoolCost

/**
 * Check if the pool margin is within valid range (0 to 1).
 *
 * @since 2.0.0
 * @category predicates
 */
export const hasValidMargin = (params: PoolParams): boolean =>
  params.margin.numerator <= params.margin.denominator && params.margin.denominator > 0n

/**
 * FastCheck arbitrary for generating random PoolParams instances for testing.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.record({
  operator: PoolKeyHash.arbitrary,
  vrfKeyhash: VrfKeyHash.arbitrary,
  pledge: FastCheck.bigInt({ min: 0n, max: 1000000000000n }),
  cost: FastCheck.bigInt({ min: 340000000n, max: 1000000000n }),
  margin: UnitInterval.arbitrary,
  rewardAccount: RewardAccount.arbitrary,
  poolOwners: FastCheck.array(KeyHash.arbitrary, {
    minLength: 1,
    maxLength: 5
  }),
  relays: FastCheck.array(Relay.arbitrary, { minLength: 0, maxLength: 3 }),
  poolMetadata: FastCheck.option(FastCheck.constant(undefined), {
    nil: undefined
  })
}).map((params) => new PoolParams(params))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse PoolParams from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse PoolParams from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode PoolParams to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (params: PoolParams, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(512, profile)
  write(w, params)
  return w.finishView()
}

/**
 * Encode PoolParams to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (params: PoolParams, profile?: EncodingProfile): string =>
  Bytes.toHex(toBytes(params, profile))
