/**
 * The decoded shapes a review surface renders.
 *
 * These are **views**, not codec models: flat, structurally comparable, and holding the raw
 * bytes a signer must be shown. They are deliberately not `@evolution-sdk/evolution`'s schema
 * classes — a review tier compares, hashes and diffs these values, and a class carrying its own
 * encoding state is the wrong shape for that. The decoders in `Decode` map Evolution's models
 * onto these.
 *
 * @since 0.1.0
 */

/** A stake or payment credential: a 28-byte hash, and whether it names a script. */
export interface Credential {
  hash: Uint8Array
  isScript: boolean
}

/** An off-chain anchor: where the document is, and the hash it must have. */
export interface Anchor {
  url: string
  dataHash: Uint8Array
}

/** DRep target of a vote-delegation certificate. */
export type DRep =
  | { readonly kind: "key"; readonly hash: Uint8Array }
  | { readonly kind: "script"; readonly hash: Uint8Array }
  | { readonly kind: "abstain" }
  | { readonly kind: "no_confidence" }

/** A stake pool's advertised relay. */
export type Relay =
  | { kind: "single_host_addr"; port?: number; ipv4?: Uint8Array; ipv6?: Uint8Array }
  | { kind: "single_host_name"; port?: number; dns: string }
  | { kind: "multi_host_name"; dns: string }

/** The parameters of a pool-registration certificate. */
export interface PoolParams {
  operator: Uint8Array
  vrfKeyhash: Uint8Array
  pledge: bigint
  cost: bigint
  /** `unit_interval` as (numerator, denominator) — never a float. */
  margin: [bigint, bigint]
  rewardAccount: Uint8Array
  owners: Array<Uint8Array>
  relays: Array<Relay>
  /** (url, metadata_hash) */
  meta?: [string, Uint8Array]
}

/**
 * A decoded transaction certificate.
 *
 * ⚠️ `other` is not a fallback for a decode failure — it is the deprecated Shelley tags 5/6 and
 * any future tag, kept with its exact bytes so the certificate still round-trips and a reviewer
 * is told that something it cannot name is present. A view that dropped it would show a
 * transaction doing less than it does.
 */
export type Certificate =
  | { type: "stake_registration"; cred: Credential }
  | { type: "stake_deregistration"; cred: Credential }
  | { type: "stake_delegation"; cred: Credential; pool: Uint8Array }
  | { type: "pool_registration"; params: PoolParams }
  | { type: "pool_retirement"; pool: Uint8Array; epoch: bigint }
  | { type: "reg"; cred: Credential; deposit: bigint }
  | { type: "unreg"; cred: Credential; deposit: bigint }
  | { type: "vote_delegation"; cred: Credential; drep: DRep }
  | { type: "stake_vote_delegation"; cred: Credential; pool: Uint8Array; drep: DRep }
  | { type: "stake_reg_delegation"; cred: Credential; pool: Uint8Array; deposit: bigint }
  | { type: "vote_reg_delegation"; cred: Credential; drep: DRep; deposit: bigint }
  | { type: "stake_vote_reg_delegation"; cred: Credential; pool: Uint8Array; drep: DRep; deposit: bigint }
  | { type: "committee_hot_auth"; cold: Credential; hot: Credential }
  | { type: "committee_cold_resign"; cold: Credential; anchor?: Anchor }
  | { type: "drep_registration"; cred: Credential; deposit: bigint; anchor?: Anchor }
  | { type: "drep_deregistration"; cred: Credential; deposit: bigint }
  | { type: "drep_update"; cred: Credential; anchor?: Anchor }
  | { type: "other"; tag: bigint; raw: Uint8Array }

/** Who is casting a vote. */
export type Voter =
  | { role: "committee_hot"; cred: Credential }
  | { role: "drep"; cred: Credential }
  | { role: "pool"; keyHash: Uint8Array }

/** A governance action's identity: the proposing transaction and the index within it. */
export interface GovActionId {
  txId: Uint8Array
  index: bigint
}

export type Vote = "no" | "yes" | "abstain"

export interface VotingProcedure {
  vote: Vote
  anchor?: Anchor
}

/** `voting_procedures` (body key 19), as ordered pairs rather than a Map. */
export type VotingProcedures = Array<[Voter, Array<[GovActionId, VotingProcedure]>]>

/**
 * A governance action.
 *
 * ⚠️ `paramUpdate` stays **raw**: the protocol-parameter update map gains keys with every era,
 * and a view that modelled the keys it knew would silently drop the rest.
 */
export type GovAction =
  | { type: "parameter_change"; prev?: GovActionId; paramUpdate: Uint8Array; policyHash?: Uint8Array }
  | { type: "hard_fork"; prev?: GovActionId; major: bigint; minor: bigint }
  | { type: "treasury_withdrawals"; withdrawals: Array<[Uint8Array, bigint]>; policyHash?: Uint8Array }
  | { type: "no_confidence"; prev?: GovActionId }
  | {
      type: "update_committee"
      prev?: GovActionId
      removed: Array<Credential>
      added: Array<[Credential, bigint]>
      threshold: [bigint, bigint]
    }
  | { type: "new_constitution"; prev?: GovActionId; anchor: Anchor; scriptHash?: Uint8Array }
  | { type: "info" }

export interface ProposalProcedure {
  deposit: bigint
  /** The 29 raw reward-account bytes, not bech32. */
  rewardAccount: Uint8Array
  govAction: GovAction
  anchor: Anchor
}

/** `mint` (body key 9): policy id → asset name → quantity, as ordered pairs. */
export type Mint = Array<[Uint8Array, Array<[Uint8Array, bigint]>]>

/**
 * A decoded Plutus datum or redeemer datum.
 *
 * ⚠️ `bigint` (CBOR tag 2 / 3) is distinct from `int` on purpose: the two encode differently, so
 * collapsing them would change the datum hash.
 */
export type PlutusData =
  | { type: "constr"; alt: bigint; fields: Array<PlutusData> }
  | { type: "map"; pairs: Array<[PlutusData, PlutusData]> }
  | { type: "list"; items: Array<PlutusData> }
  | { type: "int"; value: bigint }
  | { type: "bigint"; negative: boolean; be: Uint8Array }
  | { type: "bytes"; bytes: Uint8Array }

/** One redeemer: `(tag, index) → (data, ex_units)`. The tag is the CDDL integer. */
export interface Redeemer {
  tag: number
  index: bigint
  data: PlutusData
  /** `[mem, steps]` */
  exUnits: [bigint, bigint]
}

/** A decoded native script. */
export type NativeScript =
  | { type: "pubkey"; keyHash: Uint8Array }
  | { type: "all"; scripts: Array<NativeScript> }
  | { type: "any"; scripts: Array<NativeScript> }
  | { type: "n_of_k"; n: bigint; scripts: Array<NativeScript> }
  | { type: "invalid_before"; slot: bigint }
  | { type: "invalid_hereafter"; slot: bigint }
  /** Dijkstra `script_require_guard` (tag 6) — pre-fork. */
  | { type: "require_guard"; cred: Credential }
