/**
 * CIP-139's own wire types — `query-layer.json`, not CIP-116.
 *
 * Kept apart from the layer that produces them because they are a published schema: a
 * consumer validating a response reaches for these, and nothing here should depend on how
 * the answer was obtained.
 *
 * @since 0.1.0
 */

export type Vote = "yes" | "no" | "abstain"
export type PoolStatus = "active" | "retiring" | "retired"
export type CommitteeStatus = "authorised" | "not_authorised" | "resigned"

export interface VoteInfo {
  readonly proposal_id: string
  readonly vote_tx_hash: string
  readonly vote: Vote
}

export interface DRepInfo {
  readonly drep_id: string
  readonly amount: string
  readonly active: boolean
}

export interface CommitteeMember {
  readonly cc_cold_key: string
  readonly cc_hot_key: string
  readonly status: CommitteeStatus
}

export interface Pool {
  readonly pool_id: string
  readonly status: PoolStatus
  readonly active_stake: string
  readonly live_stake: string
}

export interface Proposal {
  readonly proposal_id: string
  readonly ratified_epoch?: number
  readonly enacted_epoch?: number
  readonly expired_epoch?: number
  readonly expiration?: number
}

/** `UnitInterval` / `NonnegativeInterval` — an exact rational, both parts decimal strings. */
export interface Interval {
  readonly numerator: string
  readonly denominator: string
}

export interface ExUnits {
  readonly mem: string
  readonly steps: string
}

export interface ProtocolParams {
  readonly minfee_a: string
  readonly minfee_b: string
  readonly max_block_body_size: number
  readonly max_tx_size: number
  readonly max_block_header_size: number
  readonly key_deposit: string
  readonly pool_deposit: string
  readonly max_epoch: number
  readonly n_opt: number
  readonly pool_pledge_influence: Interval
  readonly expansion_rate: Interval
  readonly treasury_growth_rate: Interval
  readonly min_pool_cost: string
  readonly ada_per_utxo_byte: string
  readonly cost_models: {
    readonly plutus_v1?: ReadonlyArray<string>
    readonly plutus_v2?: ReadonlyArray<string>
    readonly plutus_v3?: ReadonlyArray<string>
  }
  readonly execution_costs: { readonly mem_price: Interval; readonly step_price: Interval }
  readonly max_tx_ex_units: ExUnits
  readonly max_block_ex_units: ExUnits
  readonly max_value_size: number
  readonly collateral_percentage: number
  readonly max_collateral_inputs: number
  readonly protocol_version: { readonly major: number; readonly minor: number }
  readonly pool_voting_thresholds: ReadonlyArray<Interval>
  readonly drep_voting_thresholds: ReadonlyArray<Interval>
  readonly committee_min_size: number
  readonly committee_max_term_length: number
  readonly gov_action_lifetime: number
  readonly gov_action_deposit: string
  readonly drep_deposit: string
  readonly drep_activity: number
  readonly min_fee_ref_script_cost_per_byte: Interval
}

/**
 * The 10 operations this package does not serve, and why.
 *
 * Exported so a caller can answer "is this supported" without guessing, and so the gaps
 * stay auditable rather than being discovered one at a time by a dApp.
 *
 * @since 0.1.0
 */
export const UNIMPLEMENTED: Readonly<Record<string, string>> = {
  getBlockByNumber: "returns CIP-116 Block, a full recursive domain encoding",
  getBlockByHash: "returns CIP-116 Block, a full recursive domain encoding",
  getTransactionByHash: "returns CIP-116 Transaction; the source is the tx CBOR and a decoder, not indexer JSON",
  getTransactionByBlockNumber: "returns CIP-116 Transaction (see getTransactionByHash)",
  getTransactionByBlockHash: "returns CIP-116 Transaction (see getTransactionByHash)",
  getDatumByHash: "returns bare CIP-116 PlutusData by hash; inline datums are already served on every UTxO",
  getPlutusScriptByHash: "needs a script-by-hash provider read; the PlutusScript encoder already exists",
  getNativeScriptByHash: "returns CIP-116 NativeScript, a recursive encoding",
  getMetadataByTransactionHash:
    "returns CIP-116 TransactionMetadatum; a faithful encoding needs the metadata CBOR, not an indexer's pre-decoded JSON",
  getEraBySummary:
    "NOT ANSWERABLE from an indexer: EraSummary requires start+end+parameters, EraParameters requires safe_zone (which no indexer reports), and the current era has no `end`. It would have to be fabricated."
}
