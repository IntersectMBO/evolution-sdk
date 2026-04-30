import { Equal, FastCheck, Hash, Inspectable, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as Coin from "./Coin.js"
import * as CommitteeColdCredential from "./CommitteeColdCredential.js"
import * as Constitution from "./Constitution.js"
import * as Credential from "./Credential.js"
import * as EpochNo from "./EpochNo.js"
import * as ProtocolParamUpdate from "./ProtocolParamUpdate.js"
import * as ProtocolVersion from "./ProtocolVersion.js"
import * as RewardAccount from "./RewardAccount.js"
import * as ScriptHash from "./ScriptHash.js"
import * as TransactionHash from "./TransactionHash.js"
import * as TransactionIndex from "./TransactionIndex.js"
import * as UnitInterval from "./UnitInterval.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Helper for array equality using element-by-element comparison.
 */
const arrayEquals = <A>(a: ReadonlyArray<A> | undefined, b: ReadonlyArray<A> | undefined): boolean => {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Equal.equals(a[i], b[i])) return false
  }
  return true
}

/**
 * Helper for array hashing using element hashes.
 */
const arrayHash = <A>(arr: ReadonlyArray<A>): number => {
  let hash = 0
  for (const item of arr) {
    hash = Hash.combine(hash)(Hash.hash(item))
  }
  return hash
}

/**
 * Content-based Map equality helper.
 * Compares two Maps by content, handling nested Maps recursively.
 * Uses Equal.equals for key comparison since Map.has uses reference equality.
 */
const mapEquals = <K, V>(a: Map<K, V>, b: Map<K, V>): boolean => {
  if (a.size !== b.size) return false

  for (const [keyA, valueA] of a) {
    // Find matching key in b using Equal.equals
    let found = false
    for (const [keyB, valueB] of b) {
      if (Equal.equals(keyA, keyB)) {
        found = true
        // Handle nested Map values
        if (valueA instanceof Map && valueB instanceof Map) {
          if (!mapEquals(valueA as any, valueB as any)) return false
        } else if (!Equal.equals(valueA, valueB)) {
          return false
        }
        break
      }
    }
    if (!found) return false
  }

  return true
}

/**
 * Content-based Map hash helper.
 * XORs hashes of all entries for order-independent content-based hash.
 */
const mapHash = <K, V>(map: Map<K, V>): number => {
  let hash = 0
  for (const [key, value] of map) {
    const entryHash = Hash.combine(Hash.hash(key))(value instanceof Map ? mapHash(value as any) : Hash.hash(value))
    hash ^= entryHash
  }
  return hash
}

/**
 * GovActionId schema representing a governance action identifier.
 * ```
 * According to Conway CDDL: gov_action_id = [transaction_id : transaction_id, gov_action_index : uint .size 2]
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class GovActionId extends Schema.TaggedClass<GovActionId>()("GovActionId", {
  transactionId: TransactionHash.TransactionHash, // transaction_id (hash32)
  govActionIndex: TransactionIndex.TransactionIndex // uint .size 2 (governance action index)
}) {
  toJSON() {
    return {
      _tag: this._tag,
      transactionId: this.transactionId,
      govActionIndex: this.govActionIndex
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
      that instanceof GovActionId &&
      Equal.equals(this.transactionId, that.transactionId) &&
      Equal.equals(this.govActionIndex, that.govActionIndex)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.transactionId))(Hash.hash(this.govActionIndex)))
  }
}

/**
 * Parameter change governance action schema.
 * ```
 * According to Conway CDDL: parameter_change_action =
 *   (0, gov_action_id/ nil, protocol_param_update, policy_hash/ nil)
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class ParameterChangeAction extends Schema.TaggedClass<ParameterChangeAction>()("ParameterChangeAction", {
  govActionId: Schema.NullOr(GovActionId), // gov_action_id / nil
  protocolParamUpdate: ProtocolParamUpdate.ProtocolParamUpdate, // protocol_param_update
  policyHash: Schema.NullOr(ScriptHash.ScriptHash) // policy_hash / nil
}) {
  toJSON() {
    return {
      _tag: this._tag,
      govActionId: this.govActionId,
      protocolParamUpdate: this.protocolParamUpdate,
      policyHash: this.policyHash
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
      that instanceof ParameterChangeAction &&
      Equal.equals(this.govActionId, that.govActionId) &&
      Equal.equals(this.protocolParamUpdate, that.protocolParamUpdate) &&
      Equal.equals(this.policyHash, that.policyHash)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.combine(Hash.hash(this.govActionId))(Hash.hash(this.protocolParamUpdate)))(
        Hash.hash(this.policyHash)
      )
    )
  }
}

/**
 * Hard fork initiation governance action schema.
 * ```
 * According to Conway CDDL: hard_fork_initiation_action =
 *   (1, gov_action_id/ nil, protocol_version, policy_hash/ nil)
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class HardForkInitiationAction extends Schema.TaggedClass<HardForkInitiationAction>()(
  "HardForkInitiationAction",
  {
    govActionId: Schema.NullOr(GovActionId), // gov_action_id / nil
    protocolVersion: ProtocolVersion.ProtocolVersion // protocol_version = [major, minor]
  }
) {
  toJSON() {
    return {
      _tag: this._tag,
      govActionId: this.govActionId,
      protocolVersion: this.protocolVersion
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
      that instanceof HardForkInitiationAction &&
      Equal.equals(this.govActionId, that.govActionId) &&
      Equal.equals(this.protocolVersion, that.protocolVersion)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.govActionId))(Hash.hash(this.protocolVersion)))
  }
}

/**
 * Treasury withdrawals governance action schema.
 * ```
 * According to Conway CDDL: treasury_withdrawals_action =
 *   (2, { * reward_account => coin }, policy_hash/ nil)
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class TreasuryWithdrawalsAction extends Schema.TaggedClass<TreasuryWithdrawalsAction>()(
  "TreasuryWithdrawalsAction",
  {
    withdrawals: Schema.Map({
      key: RewardAccount.FromBech32,
      value: Coin.Coin
    }),
    policyHash: Schema.NullOr(ScriptHash.ScriptHash) // policy_hash / nil
  }
) {
  toJSON() {
    return {
      _tag: this._tag,
      withdrawals: this.withdrawals,
      policyHash: this.policyHash
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
      that instanceof TreasuryWithdrawalsAction &&
      mapEquals(this.withdrawals, that.withdrawals) &&
      Equal.equals(this.policyHash, that.policyHash)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(mapHash(this.withdrawals))(Hash.hash(this.policyHash)))
  }
}

/**
 * No confidence governance action schema.
 * ```
 * According to Conway CDDL: no_confidence =
 *   (3, gov_action_id/ nil)
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class NoConfidenceAction extends Schema.TaggedClass<NoConfidenceAction>()("NoConfidenceAction", {
  govActionId: Schema.NullOr(GovActionId) // gov_action_id / nil
}) {
  toJSON() {
    return {
      _tag: this._tag,
      govActionId: this.govActionId
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof NoConfidenceAction && Equal.equals(this.govActionId, that.govActionId)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.govActionId))
  }
}

/**
 * Update committee governance action schema.
 * ```
 * According to Conway CDDL: update_committee =
 *   (4, gov_action_id/ nil, set<committee_cold_credential>, { * committee_cold_credential => committee_hot_credential }, unit_interval)
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class UpdateCommitteeAction extends Schema.TaggedClass<UpdateCommitteeAction>()("UpdateCommitteeAction", {
  govActionId: Schema.NullOr(GovActionId), // gov_action_id / nil
  membersToRemove: Schema.Array(CommitteeColdCredential.CommitteeColdCredential.Credential), // set<committee_cold_credential>
  membersToAdd: Schema.Map({
    key: CommitteeColdCredential.CommitteeColdCredential.Credential, // committee_cold_credential
    value: EpochNo.EpochNoSchema // epoch_no
  }),
  threshold: UnitInterval.UnitInterval
}) {
  toJSON() {
    return {
      _tag: this._tag,
      govActionId: this.govActionId,
      membersToRemove: this.membersToRemove,
      membersToAdd: this.membersToAdd,
      threshold: this.threshold
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
      that instanceof UpdateCommitteeAction &&
      Equal.equals(this.govActionId, that.govActionId) &&
      arrayEquals(this.membersToRemove, that.membersToRemove) &&
      mapEquals(this.membersToAdd, that.membersToAdd) &&
      Equal.equals(this.threshold, that.threshold)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(
        Hash.combine(Hash.combine(Hash.hash(this.govActionId))(arrayHash(this.membersToRemove)))(
          mapHash(this.membersToAdd)
        )
      )(Hash.hash(this.threshold))
    )
  }
}

/**
 * New constitution governance action schema.
 * According to Conway CDDL: new_constitution =
 *   (5, gov_action_id/ nil, constitution)
 *
 * @since 2.0.0
 * @category schemas
 */
export class NewConstitutionAction extends Schema.TaggedClass<NewConstitutionAction>()("NewConstitutionAction", {
  govActionId: Schema.NullOr(GovActionId), // gov_action_id / nil
  constitution: Constitution.Constitution // constitution as CBOR
}) {
  toJSON() {
    return {
      _tag: this._tag,
      govActionId: this.govActionId,
      constitution: this.constitution
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
      that instanceof NewConstitutionAction &&
      Equal.equals(this.govActionId, that.govActionId) &&
      Equal.equals(this.constitution, that.constitution)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.govActionId))(Hash.hash(this.constitution)))
  }
}

/**
 * Info governance action schema.
 * ```
 * According to Conway CDDL: info_action = (6)
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export class InfoAction extends Schema.TaggedClass<InfoAction>()("InfoAction", {
  // Info action has no additional data
}) {
  toJSON() {
    return {
      _tag: this._tag
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof InfoAction
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.string("InfoAction"))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const writeGovActionId = (w: CborWriter, v: GovActionId): void => {
  w.writeArrayHeader(2)
  TransactionHash.write(w, v.transactionId)
  w.writeUint(BigInt(v.govActionIndex))
  w.writeArrayBreak()
}

export const readGovActionId = (r: CborReader): GovActionId => {
  const count = r.readArrayHeader()
  const transactionId = TransactionHash.read(r)
  const govActionIndex = r.readUint() as TransactionIndex.TransactionIndex
  if (count === -1) r.isBreak()
  return new GovActionId({ transactionId, govActionIndex })
}

const writeGovActionIdOrNull = (w: CborWriter, v: GovActionId | null): void => {
  if (v === null) w.writeNull()
  else writeGovActionId(w, v)
}

const readGovActionIdOrNull = (r: CborReader): GovActionId | null => {
  if (r.peekMajorType() === 7) { r.readNull(); return null }
  return readGovActionId(r)
}

const writeScriptHashOrNull = (w: CborWriter, v: ScriptHash.ScriptHash | null): void => {
  if (v === null) w.writeNull()
  else ScriptHash.write(w, v)
}

const readScriptHashOrNull = (r: CborReader): ScriptHash.ScriptHash | null => {
  if (r.peekMajorType() === 7) { r.readNull(); return null }
  return ScriptHash.read(r)
}

const writeUnitInterval = (w: CborWriter, v: UnitInterval.UnitInterval): void => {
  w.writeTagHeader(30)
  w.writeArrayHeader(2)
  w.writeUint(v.numerator)
  w.writeUint(v.denominator)
  w.writeArrayBreak()
}

const readUnitInterval = (r: CborReader): UnitInterval.UnitInterval => {
  const tag = r.readTagHeader()
  if (tag !== 30) throw new Error(`UnitInterval: expected tag 30, got ${tag}`)
  const count = r.readArrayHeader()
  const numerator = r.readUint()
  const denominator = r.readUint()
  if (count === -1) r.isBreak()
  return new UnitInterval.UnitInterval({ numerator, denominator })
}

export const write = (w: CborWriter, v: GovernanceAction): void => {
  switch (v._tag) {
    case "ParameterChangeAction":
      w.writeArrayHeader(4); w.writeSmallUint(0)
      writeGovActionIdOrNull(w, v.govActionId)
      ProtocolParamUpdate.write(w, v.protocolParamUpdate)
      writeScriptHashOrNull(w, v.policyHash)
      w.writeArrayBreak(); break
    case "HardForkInitiationAction":
      w.writeArrayHeader(3); w.writeSmallUint(1)
      writeGovActionIdOrNull(w, v.govActionId)
      ProtocolVersion.write(w, v.protocolVersion)
      w.writeArrayBreak(); break
    case "TreasuryWithdrawalsAction":
      w.writeArrayHeader(3); w.writeSmallUint(2)
      w.writeMapHeader(v.withdrawals.size)
      for (const [rewardAccount, coin] of v.withdrawals) {
        RewardAccount.write(w, rewardAccount)
        w.writeUint(coin)
      }
      w.writeMapBreak()
      writeScriptHashOrNull(w, v.policyHash)
      w.writeArrayBreak(); break
    case "NoConfidenceAction":
      w.writeArrayHeader(2); w.writeSmallUint(3)
      writeGovActionIdOrNull(w, v.govActionId)
      w.writeArrayBreak(); break
    case "UpdateCommitteeAction":
      w.writeArrayHeader(5); w.writeSmallUint(4)
      writeGovActionIdOrNull(w, v.govActionId)
      // set<committee_cold_credential> — tag 258
      w.writeTagHeader(258)
      w.writeArrayHeader(v.membersToRemove.length)
      for (const cred of v.membersToRemove) Credential.write(w, cred)
      w.writeArrayBreak()
      // map<committee_cold_credential => epoch_no>
      w.writeMapHeader(v.membersToAdd.size)
      for (const [cred, epoch] of v.membersToAdd) {
        Credential.write(w, cred)
        w.writeUint(epoch)
      }
      w.writeMapBreak()
      writeUnitInterval(w, v.threshold)
      w.writeArrayBreak(); break
    case "NewConstitutionAction":
      w.writeArrayHeader(3); w.writeSmallUint(5)
      writeGovActionIdOrNull(w, v.govActionId)
      Constitution.write(w, v.constitution)
      w.writeArrayBreak(); break
    case "InfoAction":
      w.writeArrayHeader(1); w.writeSmallUint(6)
      w.writeArrayBreak(); break
  }
}

export const read = (r: CborReader): GovernanceAction => {
  const count = r.readArrayHeader()
  const tag = r.readSmallUint()
  let result: GovernanceAction
  switch (tag) {
    case 0: {
      const govActionId = readGovActionIdOrNull(r)
      const protocolParamUpdate = ProtocolParamUpdate.read(r)
      const policyHash = readScriptHashOrNull(r)
      result = new ParameterChangeAction({ govActionId, protocolParamUpdate, policyHash })
      break
    }
    case 1: {
      const govActionId = readGovActionIdOrNull(r)
      const protocolVersion = ProtocolVersion.read(r)
      result = new HardForkInitiationAction({ govActionId, protocolVersion })
      break
    }
    case 2: {
      const mapCount = r.readMapHeader()
      const withdrawals = new Map<RewardAccount.RewardAccount, Coin.Coin>()
      if (mapCount === -1) {
        while (!r.isBreak()) { withdrawals.set(RewardAccount.read(r), r.readUint() as Coin.Coin) }
      } else {
        for (let i = 0; i < mapCount; i++) { withdrawals.set(RewardAccount.read(r), r.readUint() as Coin.Coin) }
      }
      const policyHash = readScriptHashOrNull(r)
      result = new TreasuryWithdrawalsAction({ withdrawals, policyHash })
      break
    }
    case 3: {
      const govActionId = readGovActionIdOrNull(r)
      result = new NoConfidenceAction({ govActionId })
      break
    }
    case 4: {
      const govActionId = readGovActionIdOrNull(r)
      // set<committee_cold_credential> — may be tag 258 or plain array
      let removeCount: number
      if (r.peekMajorType() === 6) {
        const setTag = r.readTagHeader()
        if (setTag !== 258) throw new Error(`UpdateCommitteeAction: expected tag 258, got ${setTag}`)
        removeCount = r.readArrayHeader()
      } else {
        removeCount = r.readArrayHeader()
      }
      const membersToRemove: Array<Credential.Credential> = []
      if (removeCount === -1) { while (!r.isBreak()) membersToRemove.push(Credential.read(r)) }
      else { for (let i = 0; i < removeCount; i++) membersToRemove.push(Credential.read(r)) }
      // map<committee_cold_credential => epoch_no>
      const addCount = r.readMapHeader()
      const membersToAdd = new Map<Credential.Credential, EpochNo.EpochNo>()
      if (addCount === -1) {
        while (!r.isBreak()) { membersToAdd.set(Credential.read(r), r.readUint() as EpochNo.EpochNo) }
      } else {
        for (let i = 0; i < addCount; i++) { membersToAdd.set(Credential.read(r), r.readUint() as EpochNo.EpochNo) }
      }
      const threshold = readUnitInterval(r)
      result = new UpdateCommitteeAction({ govActionId, membersToRemove, membersToAdd, threshold })
      break
    }
    case 5: {
      const govActionId = readGovActionIdOrNull(r)
      const constitution = Constitution.read(r)
      result = new NewConstitutionAction({ govActionId, constitution })
      break
    }
    case 6:
      result = new InfoAction({})
      break
    default:
      throw new Error(`GovernanceAction: unknown tag ${tag}`)
  }
  if (count === -1) r.isBreak()
  return result
}

/**
 * GovernanceAction union schema based on Conway CDDL specification.
 *
 * ```
 * governance_action =
 *   [ 0, parameter_change_action ]
 * / [ 1, hard_fork_initiation_action ]
 * / [ 2, treasury_withdrawals_action ]
 * / [ 3, no_confidence ]
 * / [ 4, update_committee ]
 * / [ 5, new_constitution ]
 * / [ 6, info_action ]
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export const GovernanceAction = Schema.Union(
  ParameterChangeAction,
  HardForkInitiationAction,
  TreasuryWithdrawalsAction,
  NoConfidenceAction,
  UpdateCommitteeAction,
  NewConstitutionAction,
  InfoAction
)

/**
 * Type alias for GovernanceAction.
 *
 * @since 2.0.0
 * @category model
 */
export type GovernanceAction = Schema.Schema.Type<typeof GovernanceAction>
/**
 * FastCheck arbitrary for GovernanceAction.
 *
 * @since 2.0.0
 * @category arbitrary
 */
// Per-variant arbitraries and main arbitrary

export const infoArbitrary: FastCheck.Arbitrary<InfoAction> = FastCheck.constant(new InfoAction({}))

export const govActionIdArbitrary: FastCheck.Arbitrary<GovActionId> = FastCheck.tuple(
  TransactionHash.arbitrary,
  TransactionIndex.arbitrary
).map(([transactionId, govActionIndex]) => new GovActionId({ transactionId, govActionIndex }))

export const parameterChangeArbitrary: FastCheck.Arbitrary<ParameterChangeAction> = FastCheck.tuple(
  FastCheck.option(govActionIdArbitrary, { nil: null }),
  ProtocolParamUpdate.arbitrary,
  FastCheck.option(ScriptHash.arbitrary, { nil: null })
).map(
  ([govActionId, protocolParamUpdate, policyHash]) =>
    new ParameterChangeAction({ govActionId, protocolParamUpdate, policyHash })
)

export const hardForkInitiationArbitrary: FastCheck.Arbitrary<HardForkInitiationAction> = FastCheck.tuple(
  FastCheck.option(govActionIdArbitrary, { nil: null }),
  ProtocolVersion.arbitrary
).map(([govActionId, protocolVersion]) => new HardForkInitiationAction({ govActionId, protocolVersion }))

const withdrawalsMapArbitrary: FastCheck.Arbitrary<Map<RewardAccount.RewardAccount, Coin.Coin>> = FastCheck.uniqueArray(
  RewardAccount.arbitrary,
  {
    maxLength: 5,
    selector: (ra) => RewardAccount.toHex(ra)
  }
).chain((accounts) =>
  FastCheck.array(Coin.arbitrary, { minLength: accounts.length, maxLength: accounts.length }).map(
    (coins) => new Map(accounts.map((a, i) => [a, coins[i]] as const))
  )
)

export const treasuryWithdrawalsArbitrary: FastCheck.Arbitrary<TreasuryWithdrawalsAction> = FastCheck.tuple(
  withdrawalsMapArbitrary,
  FastCheck.option(ScriptHash.arbitrary, { nil: null })
).map(([withdrawals, policyHash]) => new TreasuryWithdrawalsAction({ withdrawals, policyHash }))

export const noConfidenceArbitrary: FastCheck.Arbitrary<NoConfidenceAction> = FastCheck.option(govActionIdArbitrary, {
  nil: null
}).map((govActionId) => new NoConfidenceAction({ govActionId }))

const uniqueCredArray: FastCheck.Arbitrary<ReadonlyArray<Credential.Credential>> = FastCheck.uniqueArray(
  Credential.arbitrary,
  {
    maxLength: 5,
    selector: (c) => `${c._tag}:${Bytes.toHex(c.hash)}`
  }
)

const membersToAddMapArbitrary: FastCheck.Arbitrary<Map<Credential.Credential, EpochNo.EpochNo>> =
  uniqueCredArray.chain((colds) =>
    FastCheck.array(EpochNo.arbitrary, {
      minLength: colds.length,
      maxLength: colds.length
    }).map((epochsRaw) => {
      const epochs = epochsRaw
      const m = new Map<Credential.Credential, EpochNo.EpochNo>()
      for (let i = 0; i < colds.length; i++) m.set(colds[i], epochs[i])
      return m
    })
  )

export const updateCommitteeArbitrary: FastCheck.Arbitrary<UpdateCommitteeAction> = FastCheck.tuple(
  FastCheck.option(govActionIdArbitrary, { nil: null }),
  uniqueCredArray,
  membersToAddMapArbitrary,
  UnitInterval.arbitrary
).map(
  ([govActionId, membersToRemove, membersToAdd, threshold]) =>
    new UpdateCommitteeAction({ govActionId, membersToRemove, membersToAdd, threshold })
)

export const newConstitutionArbitrary: FastCheck.Arbitrary<NewConstitutionAction> = FastCheck.tuple(
  FastCheck.option(govActionIdArbitrary, { nil: null }),
  Constitution.arbitrary
).map(([govActionId, constitution]) => new NewConstitutionAction({ govActionId, constitution }))

export const arbitrary: FastCheck.Arbitrary<GovernanceAction> = FastCheck.oneof(
  parameterChangeArbitrary,
  hardForkInitiationArbitrary,
  updateCommitteeArbitrary,
  treasuryWithdrawalsArbitrary,
  noConfidenceArbitrary,
  newConstitutionArbitrary,
  infoArbitrary
)

/**
 * Check if a value is a valid GovernanceAction.
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = Schema.is(GovernanceAction)

/**
 * Type guards for each governance action variant.
 *
 * @since 2.0.0
 * @category type guards
 */
export const isParameterChangeAction = Schema.is(ParameterChangeAction)

export const isHardForkInitiationAction = Schema.is(HardForkInitiationAction)

export const isTreasuryWithdrawalsAction = Schema.is(TreasuryWithdrawalsAction)

export const isNoConfidenceAction = Schema.is(NoConfidenceAction)

export const isUpdateCommitteeAction = Schema.is(UpdateCommitteeAction)

export const isNewConstitutionAction = Schema.is(NewConstitutionAction)

export const isInfoAction = Schema.is(InfoAction)

/**
 * Pattern matching utility for GovernanceAction.
 *
 * @since 2.0.0
 * @category pattern matching
 */
export const match = <R>(
  action: GovernanceAction,
  patterns: {
    ParameterChangeAction: (
      govActionId: GovActionId | null,
      protocolParams: ProtocolParamUpdate.ProtocolParamUpdate,
      policyHash: ScriptHash.ScriptHash | null
    ) => R
    HardForkInitiationAction: (govActionId: GovActionId | null, protocolVersion: ProtocolVersion.ProtocolVersion) => R
    TreasuryWithdrawalsAction: (
      withdrawals: Map<RewardAccount.RewardAccount, Coin.Coin>,
      policyHash: ScriptHash.ScriptHash | null
    ) => R
    NoConfidenceAction: (govActionId: GovActionId | null) => R
    UpdateCommitteeAction: (
      govActionId: GovActionId | null,
      membersToRemove: ReadonlyArray<typeof CommitteeColdCredential.CommitteeColdCredential.Credential.Type>,
      membersToAdd: ReadonlyMap<typeof CommitteeColdCredential.CommitteeColdCredential.Credential.Type, EpochNo.EpochNo>,
      threshold: UnitInterval.UnitInterval
    ) => R
    NewConstitutionAction: (govActionId: GovActionId | null, constitution: Constitution.Constitution) => R
    InfoAction: () => R
  }
): R => {
  switch (action._tag) {
    case "ParameterChangeAction":
      return patterns.ParameterChangeAction(action.govActionId, action.protocolParamUpdate, action.policyHash)
    case "HardForkInitiationAction":
      return patterns.HardForkInitiationAction(action.govActionId, action.protocolVersion)
    case "TreasuryWithdrawalsAction":
      return patterns.TreasuryWithdrawalsAction(action.withdrawals, action.policyHash)
    case "NoConfidenceAction":
      return patterns.NoConfidenceAction(action.govActionId)
    case "UpdateCommitteeAction":
      return patterns.UpdateCommitteeAction(
        action.govActionId,
        action.membersToRemove,
        action.membersToAdd,
        action.threshold
      )
    case "NewConstitutionAction":
      return patterns.NewConstitutionAction(action.govActionId, action.constitution)
    case "InfoAction":
      return patterns.InfoAction()
  }
}

/**
 * Parse GovernanceAction from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = (hex: string, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS): GovernanceAction => {
  const bytes = Bytes.fromHex(hex)
  return fromCBOR(bytes, options)
}

/**
 * Encode GovernanceAction to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: GovernanceAction, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS): string => {
  const bytes = toCBOR(data, options)
  return Bytes.toHex(bytes)
}

/**
 * Encode GovernanceAction to CBOR bytes using direct CborWriter.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytesDirect = (data: GovernanceAction, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode GovernanceAction to CBOR hex using direct CborWriter.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHexDirect = (data: GovernanceAction, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytesDirect(data, profile))

/**
 * Parse GovernanceAction from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBOR = (
  bytes: Uint8Array,
  _options?: CBOR.CodecOptions
): GovernanceAction => {
  return read(new CborReader(bytes))
}

/**
 * Encode GovernanceAction to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBOR = (data: GovernanceAction, _options?: CBOR.CodecOptions): Uint8Array => {
  const w = new CborWriter(256)
  write(w, data)
  return w.finishView()
}
