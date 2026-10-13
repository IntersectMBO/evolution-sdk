import type { Effect } from "effect"
import { Context, Data } from "effect"

import type * as CoreAddress from "../../Address.js"
import type * as Credential from "../../Credential.js"
import type * as PlutusData from "../../Data.js"
import type * as DatumHash from "../../DatumHash.js"
import type * as NonnegativeInterval from "../../NonnegativeInterval.js"
import type * as PoolKeyHash from "../../PoolKeyHash.js"
import type * as ProtocolVersion from "../../ProtocolVersion.js"
import type * as RewardAddress from "../../RewardAddress.js"
import type * as Transaction from "../../Transaction.js"
import type * as TransactionHash from "../../TransactionHash.js"
import type * as TransactionInput from "../../TransactionInput.js"
import type * as UnitInterval from "../../UnitInterval.js"
import type * as CoreUTxO from "../../UTxO.js"
import type { EvalRedeemer } from "../EvalRedeemer.js"
import type { EffectToPromiseAPI } from "../Type.js"

/**
 * Protocol Parameters for the Cardano network.
 * Defines operational rules and limits used by providers.
 *
 * @since 2.0.0
 * @category model
 */
export type ProtocolParameters = {
  readonly minFeeA: number
  readonly minFeeB: number
  readonly maxTxSize: number
  readonly maxValSize: number
  readonly keyDeposit: bigint
  readonly poolDeposit: bigint
  readonly drepDeposit: bigint
  readonly govActionDeposit: bigint
  readonly priceMem: number
  readonly priceStep: number
  readonly maxTxExMem: bigint
  readonly maxTxExSteps: bigint
  readonly coinsPerUtxoByte: bigint
  readonly collateralPercentage: number
  readonly maxCollateralInputs: number
  readonly minFeeRefScriptCostPerByte: number
  readonly costModels: {
    readonly PlutusV1: Record<string, number>
    readonly PlutusV2: Record<string, number>
    readonly PlutusV3: Record<string, number>
  }
}

/**
 * Where the chain is right now, as the backend sees it.
 *
 * Only `slot` and `blockHash` are reported by every provider. The rest is **absent rather
 * than substituted** when a backend's tip query does not carry it: Ogmios reports neither a
 * block height nor a block time, and Maestro's chain-tip carries no epoch. A caller that
 * needs one of those has to say so, instead of silently reading a zero.
 *
 * @since 2.2.0
 * @category model
 */
export interface Tip {
  /** Absolute slot of the tip block. */
  readonly slot: number
  /** Header hash of the tip block, as hex. */
  readonly blockHash: string
  readonly epoch?: number
  readonly blockHeight?: number
  /** Wall-clock time of the tip block, unix seconds. With `slot`, an exact slot/time anchor. */
  readonly blockTime?: number
}

/**
 * Delegation information including pool ID and rewards.
 *
 * @since 2.0.0
 * @category model
 */
export interface Delegation {
  readonly poolId: PoolKeyHash.PoolKeyHash | null
  readonly rewards: bigint
  /**
   * Whether the stake key is REGISTERED on chain.
   *
   * ⚠️ Not derivable from `poolId`. A registered account that has not delegated reports
   * `poolId: null` and `rewards: 0n` — byte for byte what a never-registered account reports —
   * so the two cannot be told apart without this. CIP-95's
   * `getRegisteredPubStakeKeys` / `getUnregisteredPubStakeKeys` split is exactly that question,
   * and a dApp reads it to decide whether a vote-delegation certificate needs a registration
   * certificate alongside it. Answering it wrongly builds a transaction the node rejects.
   *
   * `undefined` where the backend does not report it, rather than a default: "not registered"
   * is a factual claim, and guessing it is the failure this field exists to prevent.
   *
   * @since 2.2.0
   */
  readonly registered: boolean | undefined
}

// ── the chain-wide query tier ───────────────────────────────────────────────────
//
// Everything above this line is the transaction builder's data dependency: what
// `newTx().build()` needs and nothing else. Everything below answers questions about
// the CHAIN rather than about the wallet's own account, which is what a governance
// screen or a CIP-139 query layer reads. No backend is obliged to serve any of it, so
// every member is optional and a consumer probes before calling — the same principle
// as {@link Tip}'s optional fields, raised from fields to methods.

/**
 * On-chain state of a stake (reward) account.
 *
 * Overlaps {@link Delegation} and is NOT a replacement for it. Three differences, each
 * load-bearing: it answers `null` for an account the chain has never seen (where
 * `getDelegation` fails, so "unknown account" and "query failed" are one outcome); it
 * carries the VOTE delegation target, which `Delegation` has no field for; and it
 * carries the registration deposit and the controlled balance.
 *
 * @since 2.0.0
 * @category model
 */
export interface AccountInfo {
  readonly registered: boolean
  /** Bech32 pool id, or `null` when the account delegates to no pool. */
  readonly delegatedPool: string | null
  /**
   * The vote-delegation target, as the backend reports it: a bech32 DRep id
   * (`drep1…` / `drep_script1…`) or one of the predefined behaviours
   * (`drep_always_abstain`, `drep_always_no_confidence`). `null` when the account has
   * not delegated its vote. Left in the backend's vocabulary deliberately — the
   * predefined targets are not registered DReps, and a caller that canonicalizes has
   * to be able to tell which it has.
   */
  readonly delegatedDRep: string | null
  readonly rewardsAvailable: bigint
  /** Deposit held for the stake-key registration, refunded on deregistration.
   * `undefined` where the backend does not report it, never zero. */
  readonly deposit: bigint | undefined
  /**
   * Total controlled lovelace (UTxO plus available rewards) at query time.
   *
   * An atomic balance read, unlike summing paginated UTxOs on a high-churn account.
   * `undefined` where the backend does not report it.
   */
  readonly controlledBalance: bigint | undefined
}

/**
 * A stake pool's identity, lifecycle state and stake.
 *
 * @since 2.0.0
 * @category model
 */
export interface PoolSummary {
  readonly poolId: string
  /**
   * Lifecycle state **as the backend spells it** (Koios: `registered` | `retiring` |
   * `retired`). Not narrowed to a union here: a consumer that must emit a standard
   * vocabulary has to translate, and translating an unrecognised value is the one
   * thing it must not do silently. Keeping the raw string makes the untranslated
   * value reachable by the code that owns the mapping.
   */
  readonly status: string
  readonly activeStake: bigint
  /** Live (current-epoch) stake. Costs a per-pool lookup on some backends, so it is
   * absent from cheap list fetches rather than zero-filled. */
  readonly liveStake?: bigint
}

/**
 * A DRep's identity, activity and delegated voting power.
 *
 * @since 2.0.0
 * @category model
 */
export interface DRepSummary {
  readonly drepId: string
  readonly active: boolean
  readonly amount: bigint
}

/**
 * A constitutional-committee member: cold key, hot key, authorization state.
 *
 * @since 2.0.0
 * @category model
 */
export interface CommitteeMember {
  readonly coldId: string
  readonly hotId: string
  /** Backend-reported (Koios: `authorized` | `not_authorized` | `resigned`). See
   * {@link PoolSummary.status} for why this is not a union. */
  readonly status: string
}

/**
 * One cast vote, as seen from any voter role.
 *
 * @since 2.0.0
 * @category model
 */
export interface VoteRecord {
  readonly proposalId: string
  readonly voteTxHash: string
  /** Backend-reported (Koios: `Yes` | `No` | `Abstain`). See {@link PoolSummary.status}. */
  readonly vote: string
}

/**
 * A governance action's identity and lifecycle epochs (absent while it is pending).
 *
 * @since 2.0.0
 * @category model
 */
export interface ProposalSummary {
  readonly proposalId: string
  readonly ratifiedEpoch?: number
  readonly enactedEpoch?: number
  readonly expiredEpoch?: number
  readonly expiration?: number
}

/**
 * The chain-wide parameters {@link ProtocolParameters} does not carry, or carries lossily.
 *
 * Two reasons this is a separate document rather than more fields on `ProtocolParameters`:
 *
 *  1. **Scope.** `ProtocolParameters` is on the hot path of every send; the Conway voting
 *     thresholds, the committee bounds and the block sizing are read by governance screens
 *     and never by a transaction.
 *  2. **Exactness.** The prices and the reference-script cost are RATIONALS on chain.
 *     `ProtocolParameters` reports them as `number`, which is what a fee calculation wants
 *     and is lossy for anything that must re-emit the parameter — a CIP-139 `UnitInterval`
 *     is `{numerator, denominator}`, and deriving one from a float is how a wrong-but-
 *     plausible threshold gets published. They appear here in their exact form.
 *
 * Every field is required: both Koios and Blockfrost serve all of them, and an optional
 * threshold is a threshold some caller silently treats as zero.
 *
 * @since 2.0.0
 * @category model
 */
export interface ChainParameters {
  /** The 5 pool voting thresholds, in CDDL order. Order IS the schema. */
  readonly poolVotingThresholds: ReadonlyArray<UnitInterval.UnitInterval>
  /** The 10 DRep voting thresholds, in CDDL order. */
  readonly drepVotingThresholds: ReadonlyArray<UnitInterval.UnitInterval>
  readonly committeeMinSize: number
  readonly committeeMaxTermLength: number
  readonly govActionLifetime: number
  readonly govActionDeposit: bigint
  readonly drepActivity: number
  readonly maxBlockBodySize: number
  readonly maxBlockHeaderSize: number
  readonly poolRetireMaxEpoch: number
  readonly stakePoolTargetNum: number
  readonly poolPledgeInfluence: NonnegativeInterval.NonnegativeInterval
  readonly monetaryExpansion: UnitInterval.UnitInterval
  readonly treasuryCut: UnitInterval.UnitInterval
  readonly minPoolCost: bigint
  readonly maxTxExMem: bigint
  readonly maxTxExSteps: bigint
  readonly maxBlockExMem: bigint
  readonly maxBlockExSteps: bigint
  readonly protocolVersion: ProtocolVersion.ProtocolVersion
  /** Execution prices, exactly. `ProtocolParameters.priceMem` / `priceStep` are the same
   * two values rounded into a `number`. */
  readonly executionPrices: {
    readonly mem: NonnegativeInterval.NonnegativeInterval
    readonly step: NonnegativeInterval.NonnegativeInterval
  }
  /** Exactly, for the same reason as {@link ChainParameters.executionPrices}. */
  readonly minFeeRefScriptCostPerByte: NonnegativeInterval.NonnegativeInterval
  /** Cost models as ORDERED integer arrays, which is what the parameter is on chain.
   * Absent for a Plutus version the chain does not yet price. */
  readonly plutusV1CostModel?: ReadonlyArray<bigint>
  readonly plutusV2CostModel?: ReadonlyArray<bigint>
  readonly plutusV3CostModel?: ReadonlyArray<bigint>
}

/**
 * Error class for provider-related operations.
 * Represents failures when communicating with blockchain providers or fetching data.
 *
 * @since 2.0.0
 * @category errors
 */
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly cause?: unknown
  readonly message: string
}> {}

/**
 * An output reference resolved by an indexer, INCLUDING one that has already been consumed.
 *
 * @since 2.6.0
 * @category model
 */
export interface ResolvedOutRef {
  readonly utxo: CoreUTxO.UTxO
  /**
   * `true` the output has been consumed, `false` it is still live, `undefined` the backend
   * does not say.
   *
   * ⚠️ `undefined` is UNKNOWN and never "unspent". A caller deciding whether a transaction it
   * holds can still be submitted must read an explicit `false`, because treating "we could not
   * tell" as spendable is the wrong answer in the direction that loses funds to a rejected
   * transaction.
   */
  readonly spent?: boolean
}

/**
 * Effect-based provider interface for blockchain data access and submission.
 * Provides methods to query UTxOs, protocol parameters, delegation info, and submit transactions.
 *
 * @since 2.0.0
 * @category model
 */
/**
 * A transaction reference as an indexer returns it: enough to order history and to tell
 * whether anything new has happened, without fetching the transaction itself.
 *
 * @since 2.4.0
 * @category model
 */
export interface IndexedTxRef {
  readonly txHash: TransactionHash.TransactionHash
  readonly blockHeight?: number
  /** Unix seconds. */
  readonly blockTime?: number
  readonly epochNo?: number
}

/**
 * One side of a transaction as an indexer reports it.
 *
 * `outpoint` is the UTxO's own identity: on an input, the outpoint being consumed; on an
 * output, this transaction's hash and the output's position. Absent when the backend omits it,
 * which is a fact about the backend rather than about the transaction.
 *
 * @since 2.4.0
 * @category model
 */
export interface IndexedTxIO {
  readonly address: CoreAddress.Address
  readonly coin: bigint
  readonly assets: ReadonlyArray<{ readonly unit: string; readonly quantity: bigint }>
  readonly outpoint?: { readonly txHash: TransactionHash.TransactionHash; readonly index: number }
}

/**
 * A certificate as an indexer reports it. Deliberately loose: the shape varies by certificate
 * type and by backend, and narrowing it here would discard what a caller came for.
 *
 * @since 2.4.0
 * @category model
 */
export interface IndexedTxCert {
  readonly type: string
  readonly info?: Record<string, unknown>
}

/**
 * A structured transaction, as an indexer returns it.
 *
 * ⚠️ This is the indexer's reading of a transaction, not the transaction. It cannot be
 * re-encoded to the bytes that were signed — use {@link IndexedTxCbor} when the bytes matter.
 *
 * @since 2.4.0
 * @category model
 */
export interface IndexedTx {
  readonly txHash: TransactionHash.TransactionHash
  readonly blockHeight?: number
  /** Unix seconds. */
  readonly blockTime?: number
  /** Absolute slot the containing block occupies. */
  readonly slot?: number
  readonly epochNo?: number
  readonly blockHashHex?: string
  readonly fee: bigint
  readonly inputs: ReadonlyArray<IndexedTxIO>
  readonly outputs: ReadonlyArray<IndexedTxIO>
  readonly withdrawals: ReadonlyArray<{ readonly stakeAddress: RewardAddress.RewardAddress; readonly amount: bigint }>
  readonly certificates: ReadonlyArray<IndexedTxCert>
  readonly mint: ReadonlyArray<{ readonly unit: string; readonly quantity: bigint }>
  readonly metadata?: Record<string, unknown>
  /**
   * The phase-2 verdict: `false` for a transaction that is ON CHAIN but whose script failed, so
   * its collateral was consumed and its outputs were never produced.
   *
   * ⚠️ **Absent is "unknown", never "valid".** Koios's `/tx_info` carries no verdict at all, and
   * a backend that cannot report one leaves this out rather than asserting `true` — which would
   * make a script-invalid transaction indistinguishable from a successful one. A caller that
   * must know, where the field is absent, reads the flag out of the transaction's own bytes via
   * {@link ProviderEffect.getTxCbor}.
   *
   * @since 2.7.0
   */
  readonly valid?: boolean
}

/**
 * A transaction's raw CBOR, as served by an indexer that can provide it.
 *
 * @since 2.4.0
 * @category model
 */
export interface IndexedTxCbor {
  readonly txHash: TransactionHash.TransactionHash
  /** Full transaction CBOR hex: `[body, witness_set, is_valid, auxiliary_data]`. */
  readonly cborHex: string
}

export interface ProviderEffect {
  /**
   * Retrieve current protocol parameters from the blockchain.
   */
  readonly getProtocolParameters: () => Effect.Effect<ProtocolParameters, ProviderError>
  /**
   * Where the chain is right now. See {@link Tip} for which fields a given backend can
   * actually report.
   *
   * ⚠️ Optional, like every other read added after the original six. Every provider shipped here
   * implements it, but the interface is implemented outside this repository too, and making a
   * member required retires those implementations at a minor version. A caller that needs the tip
   * should check for it and say so, rather than the type system promising something a
   * third-party backend never agreed to.
   *
   * @since 2.2.0
   */
  readonly getTip?: () => Effect.Effect<Tip, ProviderError>
  /**
   * Query UTxOs at a given address or by credential.
   */
  readonly getUtxos: (
    addressOrCredential: CoreAddress.Address | Credential.Credential
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * Query UTxOs at a given address or credential filtered by specific unit.
   */
  readonly getUtxosWithUnit: (
    addressOrCredential: CoreAddress.Address | Credential.Credential,
    unit: string
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * Query a single UTxO by its unit identifier.
   * Unit format: policyId (56 hex chars) + assetName (0-64 hex chars)
   */
  readonly getUtxoByUnit: (unit: string) => Effect.Effect<CoreUTxO.UTxO, ProviderError>
  /**
   * Query UTxOs by their transaction inputs (output references).
   */
  readonly getUtxosByOutRef: (
    inputs: ReadonlyArray<TransactionInput.TransactionInput>
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * Query delegation info for a reward address.
   */
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Effect.Effect<Delegation, ProviderError>
  /**
   * Query a datum by its hash.
   * Returns the parsed PlutusData structure.
   */
  readonly getDatum: (datumHash: DatumHash.DatumHash) => Effect.Effect<PlutusData.Data, ProviderError>
  /**
   * Wait for a transaction to be confirmed on the blockchain.
   */
  readonly awaitTx: (
    txHash: TransactionHash.TransactionHash,
    checkInterval?: number,
    timeout?: number
  ) => Effect.Effect<boolean, ProviderError>
  /**
   * Submit a signed transaction to the blockchain.
   * @param tx - Signed transaction to submit
   */
  readonly submitTx: (tx: Transaction.Transaction) => Effect.Effect<TransactionHash.TransactionHash, ProviderError>
  /**
   * Evaluate a transaction to determine script execution costs.
   * @param tx - Transaction to evaluate
   * @param additionalUTxOs - Additional UTxOs to include in evaluation context
   */
  readonly evaluateTx: (
    tx: Transaction.Transaction,
    additionalUTxOs?: Array<CoreUTxO.UTxO>
  ) => Effect.Effect<Array<EvalRedeemer>, ProviderError>

  // ── the chain-wide query tier; every member below is OPTIONAL ─────────────────
  //
  // A backend that cannot answer one of these omits it, and the caller probes. That is
  // the only honest shape: `getDReps` is a governance index, not something a Kupo or an
  // Ogmios has any way to serve, and a required member would force every such provider
  // to either lie or throw. `undefined` here means "this backend does not answer that
  // question" — never "the answer is empty".

  /**
   * Every UTxO currently holding some of `unit`, chain-wide.
   *
   * Distinct from {@link ProviderEffect.getUtxosWithUnit}, which narrows to one address,
   * and from {@link ProviderEffect.getUtxoByUnit}, which returns a single UTxO and fails
   * outright when two addresses hold the asset.
   *
   * @since 2.3.0
   */
  readonly getUtxosByAsset?: (unit: string) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * Every unspent UTxO for a whole stake account, in one paginated call — the
   * account-level equivalent of `getUtxos`, for a wallet with too many addresses to fan
   * out over.
   *
   * @since 2.3.0
   */
  readonly getAccountUtxos?: (
    rewardAddress: RewardAddress.RewardAddress,
    options?: { readonly offset?: number; readonly limit?: number }
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * Every output PRODUCED by a transaction, resolved.
   *
   * Keyed by transaction rather than by outpoint, so it cannot batch across
   * transactions: N outpoints spread over N transactions cost N calls. Prefer
   * `getUtxosByOutRef` whenever the indices are known. This exists because CIP-139
   * defines its per-transaction UTxO query this way.
   *
   * @since 2.3.0
   */
  readonly getUtxosOfTransaction?: (
    txHash: TransactionHash.TransactionHash
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * Stake-account state. `null` for a reward address the chain has never seen — which is
   * the whole reason this exists next to `getDelegation`. See {@link AccountInfo}.
   *
   * @since 2.3.0
   */
  readonly getAccountInfo?: (
    rewardAddress: RewardAddress.RewardAddress
  ) => Effect.Effect<AccountInfo | null, ProviderError>
  /**
   * Protocol parameters as they stood in a given epoch (`getProtocolParameters` answers
   * for the current one).
   *
   * @since 2.3.0
   */
  readonly getProtocolParametersAt?: (epoch: number) => Effect.Effect<ProtocolParameters, ProviderError>
  /**
   * The chain-wide parameters a transaction never needs and every governance read does.
   * See {@link ChainParameters}.
   *
   * @since 2.3.0
   */
  readonly getChainParameters?: () => Effect.Effect<ChainParameters, ProviderError>
  /**
   * Every registered DRep with its voting power.
   *
   * ⚠️ Unpaginated by contract, because CIP-139's `getAllDreps` is. An implementation
   * walks the backend's pages to exhaustion rather than returning a first page: a
   * truncated index reads exactly like a smaller electorate.
   *
   * @since 2.3.0
   */
  readonly getDReps?: () => Effect.Effect<Array<DRepSummary>, ProviderError>
  /** One DRep by bech32 id. `null` when the id has never been registered. @since 2.3.0 */
  readonly getDRep?: (drepId: string) => Effect.Effect<DRepSummary | null, ProviderError>
  /** The current constitutional committee. @since 2.3.0 */
  readonly getCommittee?: () => Effect.Effect<Array<CommitteeMember>, ProviderError>
  /** Every stake pool. Unpaginated by contract; see {@link ProviderEffect.getDReps}. @since 2.3.0 */
  readonly getPools?: () => Effect.Effect<Array<PoolSummary>, ProviderError>
  /** One pool by bech32 id. `null` when the backend does not know it. @since 2.3.0 */
  readonly getPool?: (poolId: string) => Effect.Effect<PoolSummary | null, ProviderError>
  /** Every governance action proposal. Unpaginated by contract. @since 2.3.0 */
  readonly getProposals?: () => Effect.Effect<Array<ProposalSummary>, ProviderError>
  /** One proposal by id. `null` when unknown. Exists so a single lookup need not walk
   * the whole proposal list. @since 2.3.0 */
  readonly getProposal?: (proposalId: string) => Effect.Effect<ProposalSummary | null, ProviderError>
  /** Votes cast by one DRep. @since 2.3.0 */
  readonly getVotesByDRep?: (drepId: string) => Effect.Effect<Array<VoteRecord>, ProviderError>
  /** Votes cast by one stake pool operator. @since 2.3.0 */
  readonly getVotesByPool?: (poolId: string) => Effect.Effect<Array<VoteRecord>, ProviderError>
  /** Votes cast by one committee member, keyed by HOT id. @since 2.3.0 */
  readonly getVotesByCommittee?: (ccHotId: string) => Effect.Effect<Array<VoteRecord>, ProviderError>
  /** Every vote cast on one proposal, across all voter roles. @since 2.3.0 */
  /**
   * Transaction references for the given addresses, newest first.
   *
   * The history tier. A transaction builder never needs this; a wallet or an explorer cannot
   * work without it, and an implementation that cannot answer must leave it undefined rather
   * than return `[]`, so a caller can say "history unavailable" instead of showing emptiness
   * as a fact.
   *
   * @since 2.4.0
   */
  readonly getTxsAt?: (
    addresses: ReadonlyArray<CoreAddress.Address>,
    options?: { readonly afterBlock?: number; readonly limit?: number; readonly offset?: number }
  ) => Effect.Effect<Array<IndexedTxRef>, ProviderError>
  /**
   * The given addresses split into batches, each of which {@link getTxsAt} serves in ONE request.
   *
   * A backend whose request body is bounded cannot serve an `offset` across a split: the global
   * rows `[offset, offset + limit)` over several address streams are only knowable by reading the
   * first `offset + limit` of every one of them. {@link getTxsAt} therefore refuses that
   * combination rather than answering a different question — which leaves a caller that pages
   * needing to know how many addresses fit, and that is this implementation's arithmetic, not the
   * caller's. Copying it beside the caller is how it drifts: a count that fits one address length
   * silently splits at another.
   *
   * Pure, because it is arithmetic over the serialized length and reaches nothing.
   *
   * ⚠️ **Absent means unbounded** — the whole list is one batch. An implementation with a limit
   * must say so here, because a caller cannot tell the two apart from the outside.
   *
   * @since 2.5.0
   */
  readonly splitAddressesForTxsAt?: (
    addresses: ReadonlyArray<CoreAddress.Address>
  ) => Array<Array<CoreAddress.Address>>
  /**
   * Transaction references for a whole stake account in one call, newest first.
   *
   * Cheaper than {@link getTxsAt} over every address the account owns, and the cheap change
   * signal for gating a history sync: compare the newest reference against the last one seen.
   *
   * @since 2.4.0
   */
  readonly getAccountTxs?: (
    stakeAddress: RewardAddress.RewardAddress,
    options?: {
      readonly afterBlock?: number
      /**
       * Exclusive upper bound on block height, for enumerating a WINDOW of history.
       *
       * ⚠️ It bounds the answer, not the work: measured against Koios, the same 1,000-block
       * span costs 1.4s near the tip and 30.7s three million blocks down, because the filter
       * is applied after the query the lower bound drives. It is required for a downward walk
       * all the same — without it every window returns the newest rows above `afterBlock`, so
       * the walk never descends.
       */
      readonly beforeBlock?: number
      /**
       * Row order by block height. Defaults to `'desc'` (newest first), which is what a change
       * probe and a downward walk both want. `'asc'` with `limit: 1` is how an account's
       * OLDEST transaction is found — the floor a backfill walks down to, in one call rather
       * than by descending into empty history to discover it is empty.
       */
      readonly order?: "asc" | "desc"
      readonly limit?: number
      readonly offset?: number
    }
  ) => Effect.Effect<Array<IndexedTxRef>, ProviderError>
  /**
   * Every payment address ever associated with a stake account, independent of whether it
   * currently holds anything.
   *
   * Discovery cannot be done from UTxOs alone: an address that has been emptied still belongs
   * to the account and may receive again.
   *
   * ⚠️ An implementation may have to choose between the two halves of that promise. Koios
   * serves the complete historical set only behind a flag whose response reached 51 MB on a
   * real mainnet key, so its adapter asks the cheap question first and pays for the full
   * enumeration only when that answers nothing — which means a FUNDED account enumerates to
   * the addresses holding value, not to every address it has used. A caller that needs the
   * complete set regardless of cost cannot read it off this member alone; one tracking an
   * account's activity should prefer the stake-keyed {@link ProviderEffect.getAccountUtxos}
   * and {@link ProviderEffect.getAccountTxs}, which need no address book at all.
   *
   * @since 2.4.0
   */
  readonly getAccountAddresses?: (
    stakeAddress: RewardAddress.RewardAddress,
    options?: { readonly offset?: number }
  ) => Effect.Effect<Array<CoreAddress.Address>, ProviderError>
  /**
   * Of the given addresses, those the chain has ever seen.
   *
   * The gap-limit question, asked in one call instead of one per address.
   *
   * @since 2.4.0
   */
  readonly getAddressesSeen?: (
    addresses: ReadonlyArray<CoreAddress.Address>
  ) => Effect.Effect<Array<CoreAddress.Address>, ProviderError>
  /**
   * How many blocks deep the chain considers a transaction, or `null` when it has not seen it.
   *
   * The block containing a transaction counts as the first confirmation, so a freshly included
   * transaction answers `1` and an unseen one answers `null` — the two are different facts and
   * `0` would conflate them.
   *
   * {@link ProviderEffect.awaitTx} answers presence, which is a weaker question: Cardano's
   * finality is probabilistic and a one-deep transaction can still be rolled back, so a flow
   * that must not act twice on the same funds needs depth rather than inclusion. A backend that
   * cannot report depth omits this member, and a caller can then say that a confirmation count
   * is unavailable rather than treating inclusion as settlement.
   *
   * @since 2.5.0
   */
  readonly getTxConfirmations?: (txHash: TransactionHash.TransactionHash) => Effect.Effect<number | null, ProviderError>
  /**
   * Structured transactions for the given hashes. See {@link IndexedTx} for why this is the
   * indexer's reading rather than the transaction itself.
   *
   * @since 2.4.0
   */
  readonly getTxInfo?: (
    txHashes: ReadonlyArray<TransactionHash.TransactionHash>
  ) => Effect.Effect<Array<IndexedTx>, ProviderError>
  /**
   * Raw transaction CBOR for the given hashes — the bytes that were signed.
   *
   * @since 2.4.0
   */
  readonly getTxCbor?: (
    txHashes: ReadonlyArray<TransactionHash.TransactionHash>
  ) => Effect.Effect<Array<IndexedTxCbor>, ProviderError>
  /**
   * A script by its hash, when the chain has seen it. `undefined` when it has not, which is a
   * different fact from a failed lookup and is why this does not fail instead.
   *
   * @since 2.4.0
   */
  readonly getScriptByHash?: (
    scriptHash: string
  ) => Effect.Effect<{ readonly bytesHex: string; readonly version: "V1" | "V2" | "V3" } | undefined, ProviderError>
  /**
   * Every UTxO held under a payment credential, across every address that uses it.
   *
   * A base address and an enterprise address sharing one payment credential are one spender;
   * asking per address misses the other.
   *
   * @since 2.4.0
   */
  readonly getUtxosByPaymentCredential?: (
    credential: Credential.Credential
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  /**
   * {@link getUtxosByPaymentCredential} for several credentials in one batched question.
   *
   * @since 2.4.0
   */
  readonly getUtxosByPaymentCredentials?: (
    credentials: ReadonlyArray<Credential.Credential>
  ) => Effect.Effect<Array<CoreUTxO.UTxO>, ProviderError>
  readonly getVotesByProposal?: (proposalId: string) => Effect.Effect<Array<VoteRecord>, ProviderError>
  /**
   * Resolve output references, keeping the ones already spent and saying which.
   *
   * ⚠️ **A different question from {@link ProviderEffect.getUtxosByOutRef}**, which answers
   * "what can I spend" and drops a consumed output entirely. That filter is right for a
   * transaction builder and wrong for a wallet asking whether a transaction it already holds
   * can still be submitted: it collapses "the output is gone" and "the backend could not
   * resolve it" into the same empty answer, so the caller cannot tell a dead transaction from
   * an unreachable indexer.
   *
   * Optional: a backend whose outpoint query cannot see a consumed output omits this member,
   * and a caller then says the state is unknown rather than guessing it.
   *
   * @since 2.6.0
   */
  readonly resolveOutRefs?: (
    inputs: ReadonlyArray<TransactionInput.TransactionInput>
  ) => Effect.Effect<Array<ResolvedOutRef>, ProviderError>
}

/**
 * A `ProviderEffect` that reports the chain tip.
 *
 * Every provider shipped in this package does, so each one types its own `effect` field with this
 * rather than asserting at each call site — while the interface keeps `getTip` optional for
 * implementations written elsewhere.
 *
 * @since 2.2.0
 * @category model
 */
export type ProviderEffectWithTip = ProviderEffect & {
  readonly getTip: NonNullable<ProviderEffect["getTip"]>
}

/**
 * Context tag for ProviderEffect dependency injection.
 * Use this to require a provider in your Effect computations.
 *
 * @since 2.0.0
 * @category model
 */
export const ProviderEffect: Context.Tag<ProviderEffect, ProviderEffect> =
  Context.GenericTag<ProviderEffect>("@evolution/ProviderService")

/**
 * Promise-based provider interface for blockchain data access and submission.
 * Auto-generated wrapper around ProviderEffect with promise-based methods.
 *
 * @since 2.0.0
 * @category model
 */
export interface Provider extends EffectToPromiseAPI<ProviderEffect> {
  readonly effect: ProviderEffect
}
