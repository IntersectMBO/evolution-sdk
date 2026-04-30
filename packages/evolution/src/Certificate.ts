/**
 * Certificate types and schemas for Cardano Conway-era transactions.
 *
 * @module Certificate
 * @since 2.0.0
 */
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Anchor from "./Anchor.js"
import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as Credential from "./Credential.js"
import * as DRep from "./DRep.js"
import * as EpochNo from "./EpochNo.js"
import * as PoolKeyHash from "./PoolKeyHash.js"
import * as PoolParams from "./PoolParams.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Register a stake credential (CDDL: stake_registration = 0).
 *
 * @since 2.0.0
 * @category certificate
 */
export class StakeRegistration extends Schema.TaggedClass<StakeRegistration>("StakeRegistration")("StakeRegistration", {
  stakeCredential: Credential.Credential
}) {
  toJSON() {
    return {
      _tag: "StakeRegistration" as const,
      stakeCredential: this.stakeCredential.toJSON()
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof StakeRegistration && Equal.equals(this.stakeCredential, that.stakeCredential)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash("StakeRegistration"))(Hash.hash(this.stakeCredential)))
  }
}

/**
 * Deregister a stake credential (CDDL: stake_deregistration = 1).
 *
 * @since 2.0.0
 * @category certificate
 */
export class StakeDeregistration extends Schema.TaggedClass<StakeDeregistration>("StakeDeregistration")(
  "StakeDeregistration",
  {
    stakeCredential: Credential.Credential
  }
) {
  toJSON() {
    return {
      _tag: "StakeDeregistration" as const,
      stakeCredential: this.stakeCredential.toJSON()
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof StakeDeregistration && Equal.equals(this.stakeCredential, that.stakeCredential)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash("StakeDeregistration"))(Hash.hash(this.stakeCredential)))
  }
}

/**
 * Delegate stake to a pool (CDDL: stake_delegation = 2).
 *
 * @since 2.0.0
 * @category certificate
 */
export class StakeDelegation extends Schema.TaggedClass<StakeDelegation>("StakeDelegation")("StakeDelegation", {
  stakeCredential: Credential.Credential,
  poolKeyHash: PoolKeyHash.PoolKeyHash
}) {
  toJSON() {
    return {
      _tag: "StakeDelegation" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      poolKeyHash: this.poolKeyHash.toJSON()
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
      that instanceof StakeDelegation &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.poolKeyHash, that.poolKeyHash)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("StakeDelegation"))(
        Hash.combine(Hash.hash(this.stakeCredential))(Hash.hash(this.poolKeyHash))
      )
    )
  }
}

/**
 * Register a stake pool (CDDL: pool_registration = 3).
 *
 * @since 2.0.0
 * @category certificate
 */
export class PoolRegistration extends Schema.TaggedClass<PoolRegistration>("PoolRegistration")("PoolRegistration", {
  poolParams: PoolParams.PoolParams
}) {
  toJSON() {
    return {
      _tag: "PoolRegistration" as const,
      poolParams: this.poolParams.toJSON()
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof PoolRegistration && Equal.equals(this.poolParams, that.poolParams)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash("PoolRegistration"))(Hash.hash(this.poolParams)))
  }
}

/**
 * Retire a stake pool at a given epoch (CDDL: pool_retirement = 4).
 *
 * @since 2.0.0
 * @category certificate
 */
export class PoolRetirement extends Schema.TaggedClass<PoolRetirement>("PoolRetirement")("PoolRetirement", {
  poolKeyHash: PoolKeyHash.PoolKeyHash,
  epoch: EpochNo.EpochNoSchema
}) {
  toJSON() {
    return {
      _tag: "PoolRetirement" as const,
      poolKeyHash: this.poolKeyHash.toJSON(),
      epoch: this.epoch.toString()
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
      that instanceof PoolRetirement &&
      Equal.equals(this.poolKeyHash, that.poolKeyHash) &&
      Equal.equals(this.epoch, that.epoch)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("PoolRetirement"))(Hash.combine(Hash.hash(this.poolKeyHash))(Hash.hash(this.epoch)))
    )
  }
}

/**
 * Conway-era stake registration with deposit (CDDL: reg_cert = 7).
 *
 * @since 2.0.0
 * @category certificate
 */
export class RegCert extends Schema.TaggedClass<RegCert>("RegCert")("RegCert", {
  stakeCredential: Credential.Credential,
  coin: Coin.Coin
}) {
  toJSON() {
    return {
      _tag: "RegCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      coin: this.coin.toString()
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
      that instanceof RegCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.coin, that.coin)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("RegCert"))(Hash.combine(Hash.hash(this.stakeCredential))(Hash.hash(this.coin)))
    )
  }
}

/**
 * Conway-era stake deregistration with deposit refund (CDDL: unreg_cert = 8).
 *
 * @since 2.0.0
 * @category certificate
 */
export class UnregCert extends Schema.TaggedClass<UnregCert>("UnregCert")("UnregCert", {
  stakeCredential: Credential.Credential,
  coin: Coin.Coin
}) {
  toJSON() {
    return {
      _tag: "UnregCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      coin: this.coin.toString()
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
      that instanceof UnregCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.coin, that.coin)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("UnregCert"))(Hash.combine(Hash.hash(this.stakeCredential))(Hash.hash(this.coin)))
    )
  }
}

/**
 * Delegate voting rights to a DRep (CDDL: vote_deleg_cert = 9).
 *
 * @since 2.0.0
 * @category certificate
 */
export class VoteDelegCert extends Schema.TaggedClass<VoteDelegCert>("VoteDelegCert")("VoteDelegCert", {
  stakeCredential: Credential.Credential,
  drep: DRep.DRep
}) {
  toJSON() {
    return {
      _tag: "VoteDelegCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      drep: this.drep
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
      that instanceof VoteDelegCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.drep, that.drep)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("VoteDelegCert"))(Hash.combine(Hash.hash(this.stakeCredential))(Hash.hash(this.drep)))
    )
  }
}

/**
 * Delegate stake to a pool and voting rights to a DRep (CDDL: stake_vote_deleg_cert = 10).
 *
 * @since 2.0.0
 * @category certificate
 */
export class StakeVoteDelegCert extends Schema.TaggedClass<StakeVoteDelegCert>("StakeVoteDelegCert")(
  "StakeVoteDelegCert",
  {
    stakeCredential: Credential.Credential,
    poolKeyHash: PoolKeyHash.PoolKeyHash,
    drep: DRep.DRep
  }
) {
  toJSON() {
    return {
      _tag: "StakeVoteDelegCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      poolKeyHash: this.poolKeyHash.toJSON(),
      drep: this.drep
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
      that instanceof StakeVoteDelegCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.poolKeyHash, that.poolKeyHash) &&
      Equal.equals(this.drep, that.drep)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("StakeVoteDelegCert"))(
        Hash.combine(Hash.hash(this.stakeCredential))(Hash.combine(Hash.hash(this.poolKeyHash))(Hash.hash(this.drep)))
      )
    )
  }
}

/**
 * Register stake and delegate to a pool in one certificate (CDDL: stake_reg_deleg_cert = 11).
 *
 * @since 2.0.0
 * @category certificate
 */
export class StakeRegDelegCert extends Schema.TaggedClass<StakeRegDelegCert>("StakeRegDelegCert")("StakeRegDelegCert", {
  stakeCredential: Credential.Credential,
  poolKeyHash: PoolKeyHash.PoolKeyHash,
  coin: Coin.Coin
}) {
  toJSON() {
    return {
      _tag: "StakeRegDelegCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      poolKeyHash: this.poolKeyHash.toJSON(),
      coin: this.coin.toString()
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
      that instanceof StakeRegDelegCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.poolKeyHash, that.poolKeyHash) &&
      Equal.equals(this.coin, that.coin)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("StakeRegDelegCert"))(
        Hash.combine(Hash.hash(this.stakeCredential))(Hash.combine(Hash.hash(this.poolKeyHash))(Hash.hash(this.coin)))
      )
    )
  }
}

/**
 * Register stake and delegate voting rights to a DRep (CDDL: vote_reg_deleg_cert = 12).
 *
 * @since 2.0.0
 * @category certificate
 */
export class VoteRegDelegCert extends Schema.TaggedClass<VoteRegDelegCert>("VoteRegDelegCert")("VoteRegDelegCert", {
  stakeCredential: Credential.Credential,
  drep: DRep.DRep,
  coin: Coin.Coin
}) {
  toJSON() {
    return {
      _tag: "VoteRegDelegCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      drep: this.drep,
      coin: this.coin.toString()
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
      that instanceof VoteRegDelegCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.drep, that.drep) &&
      Equal.equals(this.coin, that.coin)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("VoteRegDelegCert"))(
        Hash.combine(Hash.hash(this.stakeCredential))(Hash.combine(Hash.hash(this.drep))(Hash.hash(this.coin)))
      )
    )
  }
}

/**
 * Register stake, delegate to a pool, and delegate voting rights to a DRep (CDDL: stake_vote_reg_deleg_cert = 13).
 *
 * @since 2.0.0
 * @category certificate
 */
export class StakeVoteRegDelegCert extends Schema.TaggedClass<StakeVoteRegDelegCert>("StakeVoteRegDelegCert")(
  "StakeVoteRegDelegCert",
  {
    stakeCredential: Credential.Credential,
    poolKeyHash: PoolKeyHash.PoolKeyHash,
    drep: DRep.DRep,
    coin: Coin.Coin
  }
) {
  toJSON() {
    return {
      _tag: "StakeVoteRegDelegCert" as const,
      stakeCredential: this.stakeCredential.toJSON(),
      poolKeyHash: this.poolKeyHash.toJSON(),
      drep: this.drep,
      coin: this.coin.toString()
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
      that instanceof StakeVoteRegDelegCert &&
      Equal.equals(this.stakeCredential, that.stakeCredential) &&
      Equal.equals(this.poolKeyHash, that.poolKeyHash) &&
      Equal.equals(this.drep, that.drep) &&
      Equal.equals(this.coin, that.coin)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("StakeVoteRegDelegCert"))(
        Hash.combine(Hash.hash(this.stakeCredential))(
          Hash.combine(Hash.hash(this.poolKeyHash))(Hash.combine(Hash.hash(this.drep))(Hash.hash(this.coin)))
        )
      )
    )
  }
}

/**
 * Authorize a committee hot credential (CDDL: auth_committee_hot_cert = 14).
 *
 * @since 2.0.0
 * @category certificate
 */
export class AuthCommitteeHotCert extends Schema.TaggedClass<AuthCommitteeHotCert>("AuthCommitteeHotCert")(
  "AuthCommitteeHotCert",
  {
    committeeColdCredential: Credential.Credential,
    committeeHotCredential: Credential.Credential
  }
) {
  toJSON() {
    return {
      _tag: "AuthCommitteeHotCert" as const,
      committeeColdCredential: this.committeeColdCredential.toJSON(),
      committeeHotCredential: this.committeeHotCredential.toJSON()
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
      that instanceof AuthCommitteeHotCert &&
      Equal.equals(this.committeeColdCredential, that.committeeColdCredential) &&
      Equal.equals(this.committeeHotCredential, that.committeeHotCredential)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("AuthCommitteeHotCert"))(
        Hash.combine(Hash.hash(this.committeeColdCredential))(Hash.hash(this.committeeHotCredential))
      )
    )
  }
}

/**
 * Resign a committee cold credential (CDDL: resign_committee_cold_cert = 15).
 *
 * @since 2.0.0
 * @category certificate
 */
export class ResignCommitteeColdCert extends Schema.TaggedClass<ResignCommitteeColdCert>("ResignCommitteeColdCert")(
  "ResignCommitteeColdCert",
  {
    committeeColdCredential: Credential.Credential,
    anchor: Schema.NullishOr(Anchor.Anchor)
  }
) {
  toJSON() {
    return {
      _tag: "ResignCommitteeColdCert" as const,
      committeeColdCredential: this.committeeColdCredential.toJSON(),
      anchor: this.anchor
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
      that instanceof ResignCommitteeColdCert &&
      Equal.equals(this.committeeColdCredential, that.committeeColdCredential) &&
      Equal.equals(this.anchor, that.anchor)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("ResignCommitteeColdCert"))(
        Hash.combine(Hash.hash(this.committeeColdCredential))(Hash.hash(this.anchor))
      )
    )
  }
}

/**
 * Register as a DRep (CDDL: reg_drep_cert = 16).
 *
 * @since 2.0.0
 * @category certificate
 */
export class RegDrepCert extends Schema.TaggedClass<RegDrepCert>("RegDrepCert")("RegDrepCert", {
  drepCredential: Credential.Credential,
  coin: Coin.Coin,
  anchor: Schema.NullishOr(Anchor.Anchor)
}) {
  toJSON() {
    return {
      _tag: "RegDrepCert" as const,
      drepCredential: this.drepCredential.toJSON(),
      coin: this.coin.toString(),
      anchor: this.anchor
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
      that instanceof RegDrepCert &&
      Equal.equals(this.drepCredential, that.drepCredential) &&
      Equal.equals(this.coin, that.coin) &&
      Equal.equals(this.anchor, that.anchor)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("RegDrepCert"))(
        Hash.combine(Hash.hash(this.drepCredential))(Hash.combine(Hash.hash(this.coin))(Hash.hash(this.anchor)))
      )
    )
  }
}

/**
 * Unregister as a DRep (CDDL: unreg_drep_cert = 17).
 *
 * @since 2.0.0
 * @category certificate
 */
export class UnregDrepCert extends Schema.TaggedClass<UnregDrepCert>("UnregDrepCert")("UnregDrepCert", {
  drepCredential: Credential.Credential,
  coin: Coin.Coin
}) {
  toJSON() {
    return {
      _tag: "UnregDrepCert" as const,
      drepCredential: this.drepCredential.toJSON(),
      coin: this.coin.toString()
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
      that instanceof UnregDrepCert &&
      Equal.equals(this.drepCredential, that.drepCredential) &&
      Equal.equals(this.coin, that.coin)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("UnregDrepCert"))(Hash.combine(Hash.hash(this.drepCredential))(Hash.hash(this.coin)))
    )
  }
}

/**
 * Update DRep metadata anchor (CDDL: update_drep_cert = 18).
 *
 * @since 2.0.0
 * @category certificate
 */
export class UpdateDrepCert extends Schema.TaggedClass<UpdateDrepCert>("UpdateDrepCert")("UpdateDrepCert", {
  drepCredential: Credential.Credential,
  anchor: Schema.NullishOr(Anchor.Anchor)
}) {
  toJSON() {
    return {
      _tag: "UpdateDrepCert" as const,
      drepCredential: this.drepCredential.toJSON(),
      anchor: this.anchor
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
      that instanceof UpdateDrepCert &&
      Equal.equals(this.drepCredential, that.drepCredential) &&
      Equal.equals(this.anchor, that.anchor)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("UpdateDrepCert"))(Hash.combine(Hash.hash(this.drepCredential))(Hash.hash(this.anchor)))
    )
  }
}

/**
 * Certificate union schema based on Conway CDDL specification
 *
 * CDDL: certificate =
 *   [
 *   stake_registration
 *   // stake_deregistration
 *   // stake_delegation
 *   // pool_registration
 *   // pool_retirement
 *   // reg_cert
 *   // unreg_cert
 *   // vote_deleg_cert
 *   // stake_vote_deleg_cert
 *   // stake_reg_deleg_cert
 *   // vote_reg_deleg_cert
 *   // stake_vote_reg_deleg_cert
 *   // auth_committee_hot_cert
 *   // resign_committee_cold_cert
 *   // reg_drep_cert
 *   // unreg_drep_cert
 *   // update_drep_cert
 *   ]
 *
 * stake_registration = (0, stake_credential)
 * stake_deregistration = (1, stake_credential)
 * stake_delegation = (2, stake_credential, pool_keyhash)
 * pool_registration = (3, pool_params)
 * pool_retirement = (4, pool_keyhash, epoch_no)
 * reg_cert = (7, stake_credential, coin)
 * unreg_cert = (8, stake_credential, coin)
 * vote_deleg_cert = (9, stake_credential, drep)
 * stake_vote_deleg_cert = (10, stake_credential, pool_keyhash, drep)
 * stake_reg_deleg_cert = (11, stake_credential, pool_keyhash, coin)
 * vote_reg_deleg_cert = (12, stake_credential, drep, coin)
 * stake_vote_reg_deleg_cert = (13, stake_credential, pool_keyhash, drep, coin)
 * auth_committee_hot_cert = (14, committee_cold_credential, committee_hot_credential)
 * resign_committee_cold_cert = (15, committee_cold_credential, anchor/ nil)
 * reg_drep_cert = (16, drep_credential, coin, anchor/ nil)
 * unreg_drep_cert = (17, drep_credential, coin)
 * update_drep_cert = (18, drep_credential, anchor/ nil)
 *
 * @since 2.0.0
 * @category schemas
 */
export const Certificate = Schema.Union(
  // 0: stake_registration = (0, stake_credential)
  StakeRegistration,
  // 1: stake_deregistration = (1, stake_credential)
  StakeDeregistration,
  // 2: stake_delegation = (2, stake_credential, pool_keyhash)
  StakeDelegation,
  // 3: pool_registration = (3, pool_params)
  PoolRegistration,
  // 4: pool_retirement = (4, pool_keyhash, epoch_no)
  PoolRetirement,
  // 7: reg_cert = (7, stake_credential, coin)
  RegCert,
  // 8: unreg_cert = (8, stake_credential, coin)
  UnregCert,
  // 9: vote_deleg_cert = (9, stake_credential, drep)
  VoteDelegCert,
  // 10: stake_vote_deleg_cert = (10, stake_credential, pool_keyhash, drep)
  StakeVoteDelegCert,
  // 11: stake_reg_deleg_cert = (11, stake_credential, pool_keyhash, coin)
  StakeRegDelegCert,
  // 12: vote_reg_deleg_cert = (12, stake_credential, drep, coin)
  VoteRegDelegCert,
  // 13: stake_vote_reg_deleg_cert = (13, stake_credential, pool_keyhash, drep, coin)
  StakeVoteRegDelegCert,
  // 14: auth_committee_hot_cert = (14, committee_cold_credential, committee_hot_credential)
  AuthCommitteeHotCert,
  // 15: resign_committee_cold_cert = (15, committee_cold_credential, anchor/ nil)
  ResignCommitteeColdCert,
  // 16: reg_drep_cert = (16, drep_credential, coin, anchor/ nil)
  RegDrepCert,
  // 17: unreg_drep_cert = (17, drep_credential, coin)
  UnregDrepCert,
  // 18: update_drep_cert = (18, drep_credential, anchor/ nil)
  UpdateDrepCert
)

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Certificate): void => {
  switch (v._tag) {
    case "StakeRegistration":
      w.writeArrayHeader(2); w.writeSmallUint(0); Credential.write(w, v.stakeCredential); w.writeArrayBreak(); break
    case "StakeDeregistration":
      w.writeArrayHeader(2); w.writeSmallUint(1); Credential.write(w, v.stakeCredential); w.writeArrayBreak(); break
    case "StakeDelegation":
      w.writeArrayHeader(3); w.writeSmallUint(2); Credential.write(w, v.stakeCredential); PoolKeyHash.write(w, v.poolKeyHash); w.writeArrayBreak(); break
    case "PoolRegistration":
      // pool_registration = (3, pool_params) — pool_params fields are inline
      w.writeArrayHeader(10); w.writeSmallUint(3); PoolParams.write(w, v.poolParams); w.writeArrayBreak(); break
    case "PoolRetirement":
      w.writeArrayHeader(3); w.writeSmallUint(4); PoolKeyHash.write(w, v.poolKeyHash); w.writeUint(v.epoch); w.writeArrayBreak(); break
    case "RegCert":
      w.writeArrayHeader(3); w.writeSmallUint(7); Credential.write(w, v.stakeCredential); w.writeUint(v.coin); w.writeArrayBreak(); break
    case "UnregCert":
      w.writeArrayHeader(3); w.writeSmallUint(8); Credential.write(w, v.stakeCredential); w.writeUint(v.coin); w.writeArrayBreak(); break
    case "VoteDelegCert":
      w.writeArrayHeader(3); w.writeSmallUint(9); Credential.write(w, v.stakeCredential); DRep.write(w, v.drep); w.writeArrayBreak(); break
    case "StakeVoteDelegCert":
      w.writeArrayHeader(4); w.writeSmallUint(10); Credential.write(w, v.stakeCredential); PoolKeyHash.write(w, v.poolKeyHash); DRep.write(w, v.drep); w.writeArrayBreak(); break
    case "StakeRegDelegCert":
      w.writeArrayHeader(4); w.writeSmallUint(11); Credential.write(w, v.stakeCredential); PoolKeyHash.write(w, v.poolKeyHash); w.writeUint(v.coin); w.writeArrayBreak(); break
    case "VoteRegDelegCert":
      w.writeArrayHeader(4); w.writeSmallUint(12); Credential.write(w, v.stakeCredential); DRep.write(w, v.drep); w.writeUint(v.coin); w.writeArrayBreak(); break
    case "StakeVoteRegDelegCert":
      w.writeArrayHeader(5); w.writeSmallUint(13); Credential.write(w, v.stakeCredential); PoolKeyHash.write(w, v.poolKeyHash); DRep.write(w, v.drep); w.writeUint(v.coin); w.writeArrayBreak(); break
    case "AuthCommitteeHotCert":
      w.writeArrayHeader(3); w.writeSmallUint(14); Credential.write(w, v.committeeColdCredential); Credential.write(w, v.committeeHotCredential); w.writeArrayBreak(); break
    case "ResignCommitteeColdCert":
      w.writeArrayHeader(3); w.writeSmallUint(15); Credential.write(w, v.committeeColdCredential)
      if (v.anchor) Anchor.write(w, v.anchor); else w.writeNull()
      w.writeArrayBreak(); break
    case "RegDrepCert":
      w.writeArrayHeader(4); w.writeSmallUint(16); Credential.write(w, v.drepCredential); w.writeUint(v.coin)
      if (v.anchor) Anchor.write(w, v.anchor); else w.writeNull()
      w.writeArrayBreak(); break
    case "UnregDrepCert":
      w.writeArrayHeader(3); w.writeSmallUint(17); Credential.write(w, v.drepCredential); w.writeUint(v.coin); w.writeArrayBreak(); break
    case "UpdateDrepCert":
      w.writeArrayHeader(3); w.writeSmallUint(18); Credential.write(w, v.drepCredential)
      if (v.anchor) Anchor.write(w, v.anchor); else w.writeNull()
      w.writeArrayBreak(); break
  }
}

export const read = (r: CborReader): Certificate => {
  const count = r.readArrayHeader()
  const tag = r.readSmallUint()
  let result: Certificate
  switch (tag) {
    case 0: result = new StakeRegistration({ stakeCredential: Credential.read(r) }); break
    case 1: result = new StakeDeregistration({ stakeCredential: Credential.read(r) }); break
    case 2: result = new StakeDelegation({ stakeCredential: Credential.read(r), poolKeyHash: PoolKeyHash.read(r) }); break
    case 3: result = new PoolRegistration({ poolParams: PoolParams.read(r) }); break
    case 4: result = new PoolRetirement({ poolKeyHash: PoolKeyHash.read(r), epoch: r.readUint() as EpochNo.EpochNo }); break
    case 7: result = new RegCert({ stakeCredential: Credential.read(r), coin: r.readUint() as Coin.Coin }); break
    case 8: result = new UnregCert({ stakeCredential: Credential.read(r), coin: r.readUint() as Coin.Coin }); break
    case 9: result = new VoteDelegCert({ stakeCredential: Credential.read(r), drep: DRep.read(r) }); break
    case 10: result = new StakeVoteDelegCert({ stakeCredential: Credential.read(r), poolKeyHash: PoolKeyHash.read(r), drep: DRep.read(r) }); break
    case 11: result = new StakeRegDelegCert({ stakeCredential: Credential.read(r), poolKeyHash: PoolKeyHash.read(r), coin: r.readUint() as Coin.Coin }); break
    case 12: result = new VoteRegDelegCert({ stakeCredential: Credential.read(r), drep: DRep.read(r), coin: r.readUint() as Coin.Coin }); break
    case 13: result = new StakeVoteRegDelegCert({ stakeCredential: Credential.read(r), poolKeyHash: PoolKeyHash.read(r), drep: DRep.read(r), coin: r.readUint() as Coin.Coin }); break
    case 14: result = new AuthCommitteeHotCert({ committeeColdCredential: Credential.read(r), committeeHotCredential: Credential.read(r) }); break
    case 15: {
      const committeeColdCredential = Credential.read(r)
      const anchor = r.peekMajorType() === 7 ? (r.readNull(), undefined) : Anchor.read(r)
      result = new ResignCommitteeColdCert({ committeeColdCredential, anchor })
      break
    }
    case 16: {
      const drepCredential = Credential.read(r)
      const coin = r.readUint() as Coin.Coin
      const anchor = r.peekMajorType() === 7 ? (r.readNull(), undefined) : Anchor.read(r)
      result = new RegDrepCert({ drepCredential, coin, anchor })
      break
    }
    case 17: result = new UnregDrepCert({ drepCredential: Credential.read(r), coin: r.readUint() as Coin.Coin }); break
    case 18: {
      const drepCredential = Credential.read(r)
      const anchor = r.peekMajorType() === 7 ? (r.readNull(), undefined) : Anchor.read(r)
      result = new UpdateDrepCert({ drepCredential, anchor })
      break
    }
    default: throw new Error(`Certificate: unknown tag ${tag}`)
  }
  if (count === -1) r.isBreak()
  return result
}
/**
 * CDDL schema for Certificate based on Conway specification.
 *
 * Transforms between CBOR tuple representation and Certificate union.
 * Each certificate type is encoded as [type_id, ...fields]
 *
 * @since 2.0.0
 * @category schemas
 */
/**
 * CBOR bytes transformation schema for Certificate.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Certificate),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Certificate.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Certificate.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Certificate.FromCBORHex" })

/**
 * Type alias for Certificate.
 *
 * @since 2.0.0
 * @category model
 */
export type Certificate = typeof Certificate.Type

/**
 * Check if the given value is a valid Certificate.
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = Schema.is(Certificate)

/**
 * FastCheck arbitrary for Certificate instances.
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.oneof(
  // StakeRegistration
  Credential.arbitrary.map((stakeCredential) => new StakeRegistration({ stakeCredential })),
  // StakeDeregistration
  Credential.arbitrary.map((stakeCredential) => new StakeDeregistration({ stakeCredential })),
  // StakeDelegation
  FastCheck.tuple(Credential.arbitrary, PoolKeyHash.arbitrary).map(
    ([stakeCredential, poolKeyHash]) => new StakeDelegation({ stakeCredential, poolKeyHash })
  ),
  // PoolRegistration
  PoolParams.arbitrary.map((poolParams) => new PoolRegistration({ poolParams })),
  // PoolRetirement
  FastCheck.tuple(PoolKeyHash.arbitrary, EpochNo.generator).map(
    ([poolKeyHash, epoch]) => new PoolRetirement({ poolKeyHash, epoch: epoch as EpochNo.EpochNo })
  ),
  // RegCert
  FastCheck.tuple(Credential.arbitrary, Coin.arbitrary).map(
    ([stakeCredential, coin]) => new RegCert({ stakeCredential, coin })
  ),
  // UnregCert
  FastCheck.tuple(Credential.arbitrary, Coin.arbitrary).map(
    ([stakeCredential, coin]) => new UnregCert({ stakeCredential, coin })
  ),
  // VoteDelegCert
  FastCheck.tuple(Credential.arbitrary, DRep.arbitrary).map(
    ([stakeCredential, drep]) => new VoteDelegCert({ stakeCredential, drep })
  ),
  // StakeVoteDelegCert
  FastCheck.tuple(Credential.arbitrary, PoolKeyHash.arbitrary, DRep.arbitrary).map(
    ([stakeCredential, poolKeyHash, drep]) => new StakeVoteDelegCert({ stakeCredential, poolKeyHash, drep })
  ),
  // StakeRegDelegCert
  FastCheck.tuple(Credential.arbitrary, PoolKeyHash.arbitrary, Coin.arbitrary).map(
    ([stakeCredential, poolKeyHash, coin]) => new StakeRegDelegCert({ stakeCredential, poolKeyHash, coin })
  ),
  // VoteRegDelegCert
  FastCheck.tuple(Credential.arbitrary, DRep.arbitrary, Coin.arbitrary).map(
    ([stakeCredential, drep, coin]) => new VoteRegDelegCert({ stakeCredential, drep, coin })
  ),
  // StakeVoteRegDelegCert
  FastCheck.tuple(Credential.arbitrary, PoolKeyHash.arbitrary, DRep.arbitrary, Coin.arbitrary).map(
    ([stakeCredential, poolKeyHash, drep, coin]) =>
      new StakeVoteRegDelegCert({ stakeCredential, poolKeyHash, drep, coin })
  ),
  // AuthCommitteeHotCert
  FastCheck.tuple(Credential.arbitrary, Credential.arbitrary).map(
    ([committeeColdCredential, committeeHotCredential]) =>
      new AuthCommitteeHotCert({ committeeColdCredential, committeeHotCredential })
  ),
  // ResignCommitteeColdCert
  FastCheck.tuple(Credential.arbitrary, FastCheck.option(Anchor.arbitrary, { nil: undefined })).map(
    ([committeeColdCredential, anchor]) => new ResignCommitteeColdCert({ committeeColdCredential, anchor })
  ),
  // RegDrepCert
  FastCheck.tuple(Credential.arbitrary, Coin.arbitrary, FastCheck.option(Anchor.arbitrary, { nil: undefined })).map(
    ([drepCredential, coin, anchor]) => new RegDrepCert({ drepCredential, coin, anchor })
  ),
  // UnregDrepCert
  FastCheck.tuple(Credential.arbitrary, Coin.arbitrary).map(
    ([drepCredential, coin]) => new UnregDrepCert({ drepCredential, coin })
  ),
  // UpdateDrepCert
  FastCheck.tuple(Credential.arbitrary, FastCheck.option(Anchor.arbitrary, { nil: undefined })).map(
    ([drepCredential, anchor]) => new UpdateDrepCert({ drepCredential, anchor })
  )
)

/**
 * Parse a Certificate from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a Certificate from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert a Certificate to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (certificate: Certificate, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, certificate)
  return w.finishView()
}

/**
 * Convert a Certificate to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (certificate: Certificate, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(certificate, profile))
