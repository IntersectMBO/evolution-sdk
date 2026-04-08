/**
 * Transaction builder storing a sequence of deferred operations that assemble and balance a transaction.
 *
 * @module TransactionBuilder
 * @since 2.0.0
 *
 * ## Execution Model
 *
 * The builder pattern:
 * - **Immutable configuration** at construction (protocol params, change address, available UTxOs)
 * - **ProgramSteps array** accumulates deferred effects via chainable API methods
 * - **Fresh state per build()** — each execution creates new Ref instances, runs all programs sequentially
 * - **Deferred composition** — no I/O or state updates occur until build() is invoked
 *
 * Key invariant: calling `build()` twice with the same builder instance produces two independent results
 * with no cross-contamination because fresh state (Refs) is created each time.
 *
 * ## Coin Selection
 *
 * Automatic coin selection selects UTxOs from `availableUtxos` to satisfy transaction outputs and fees.
 * The `collectFrom()` method allows manual input selection; automatic selection excludes these to prevent
 * double-spending. UTxOs can come from any source (wallet, DeFi protocols, other participants, etc.).
 *
 * @since 2.0.0
 */

// Effect-TS imports
import type * as Effect from "effect/Effect"
import type { Either } from "effect/Either"

import type * as Script from "../../Script.js"
import type * as UTxO from "../../UTxO.js"
import type * as Provider from "../provider/Provider.js"
import type * as Wallet from "../wallet/Wallet.js"
import type {
  BuildOptions,
  EvaluationError,
  ProgramStep,
  TransactionBuilderError,
  TxBuilderConfig
} from "./internal/ctx.js"
import * as BuilderFactory from "./internal/factory.js"
import type {
  AddSignerParams,
  AttachMetadataParams,
  AuthCommitteeHotParams,
  CollectFromParams,
  DelegateToDRepParams,
  DelegateToParams,
  DelegateToPoolAndDRepParams,
  DelegateToPoolParams,
  DeregisterDRepParams,
  DeregisterStakeParams,
  MintTokensParams,
  PayToAddressParams,
  ProposeParams,
  ReadFromParams,
  RegisterAndDelegateToParams,
  RegisterDRepParams,
  RegisterPoolParams,
  RegisterStakeParams,
  ResignCommitteeColdParams,
  RetirePoolParams,
  SendAllParams,
  UpdateDRepParams,
  ValidityParams,
  VoteParams,
  WithdrawParams
} from "./operations/Operations.js"
import type { SignBuilder } from "./SignBuilder.js"
import type { TransactionResultBase } from "./TransactionResult.js"

export type {
  BuildOptions,
  DeferredRedeemerData,
  EvaluationContext,
  Evaluator,
  PhaseContext,
  ProgramStep,
  ProtocolParameters,
  RedeemerData,
  ScriptFailure,
  TxBuilderConfig,
  TxBuilderState,
  UnfrackAdaOptions,
  UnfrackOptions,
  UnfrackTokenOptions
} from "./internal/ctx.js"
export {
  AvailableUtxosTag,
  BuildOptionsTag,
  ChangeAddressTag,
  EvaluationError,
  PhaseContextTag,
  ProtocolParametersTag,
  TransactionBuilderError,
  TxBuilderConfigTag,
  TxContext
} from "./internal/ctx.js"

/**
 * Result type for transaction chaining operations.
 *
 * Provides consumed and available UTxOs for building chained transactions.
 * The available UTxOs include both remaining unspent inputs AND newly created outputs
 * with pre-computed txHash, ready to be spent in subsequent transactions.
 *
 * Accessed via `SignBuilder.chainResult()` after calling `build()`.
 *
 * @since 2.0.0
 * @category model
 */
export interface ChainResult {
  /** UTxOs consumed from availableUtxos by coin selection */
  readonly consumed: ReadonlyArray<UTxO.UTxO>
  /** Available UTxOs: remaining unspent + newly created (with computed txHash) */
  readonly available: ReadonlyArray<UTxO.UTxO>
  /** Pre-computed transaction hash (blake2b-256 of transaction body) */
  readonly txHash: string
}

// ============================================================================
// Transaction Builder Interface - Hybrid Effect/Promise API
// ============================================================================

/**
 * TransactionBuilder with hybrid Effect/Promise API following lucid-evolution pattern.
 *
 * Architecture:
 * - Immutable builder instance stores array of ProgramSteps
 * - Chainable methods create ProgramSteps and return same builder instance
 * - Completion methods (build, chain, etc.) execute all stored ProgramSteps with FRESH state
 * - Builder can be reused - each build() call is independent with its own state
 *
 * Key Design Principle:
 * Builder instance never mutates. Programs are deferred Effects that execute later.
 * Each build() creates fresh TxBuilderState, executes programs, returns result.
 *
 * Generic Type Parameter:
 * TResult determines the return type of build() methods:
 * - SignBuilder: When wallet has signing capability (SigningClient)
 * - TransactionResultBase: When wallet is read-only (ReadOnlyClient)
 *
 * Usage Pattern:
 * ```typescript
 * const builder = makeTxBuilder(provider, params, costModels, utxos)
 *   .payToAddress({ address: "addr1...", assets: { lovelace: 5_000_000n } })
 *   .collectFrom({ inputs: [utxo1, utxo2] })
 *
 * // First build - creates fresh state, executes programs
 * const signBuilder1 = await builder.build()
 *
 * // Second build - NEW fresh state, independent execution
 * const signBuilder2 = await builder.build()
 * ```
 *
 * @typeParam TResult - The result type returned by build methods (SignBuilder or TransactionResultBase)
 *
 * @since 2.0.0
 * @category interfaces
 */

/**
 * Conditional type to determine the result type based on wallet capability.
 * - If wallet has signTx method (SigningWallet or ApiWallet): SignBuilder
 * - Otherwise: TransactionResultBase
 *
 * @internal
 */
export type BuildResultType<W extends TxBuilderConfig["wallet"] | undefined> = W extends
  | Wallet.SigningWallet
  | Wallet.ApiWallet
  ? SignBuilder
  : TransactionResultBase

/**
 * Base interface for both signing and read-only transaction builders.
 * Provides chainable builder methods common to both.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export interface TransactionBuilderBase {
  /**
   * Append a payment output to the transaction.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly payToAddress: (params: PayToAddressParams) => this

  /**
   * Specify transaction inputs from provided UTxOs.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly collectFrom: (params: CollectFromParams) => this

  /**
   * Send all wallet assets to a recipient address.
   *
   * This operation collects all wallet UTxOs and creates a single output
   * containing all assets minus the transaction fee. No change output is created.
   *
   * Use cases:
   * - Draining a wallet completely
   * - Consolidating all UTxOs into a single output
   * - Migrating funds to a new address
   *
   * **Important**: This operation is mutually exclusive with `payToAddress` and `collectFrom`.
   * When `sendAll` is used, all wallet UTxOs are automatically collected and the output
   * is automatically created. Any existing outputs or inputs will cause an error.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import { Address } from "@evolution-sdk/evolution"
   *
   * const tx = await client
   *   .newTx()
   *   .sendAll({ to: Address.fromBech32("addr1...") })
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly sendAll: (params: SendAllParams) => this

  /**
   * Attach a script to the transaction.
   *
   * Scripts must be attached before being referenced by transaction inputs, minting policies,
   * or certificate operations. The script is stored in the builder state and indexed by its hash
   * for efficient lookup during transaction assembly.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import * as Script from "../../Script.js"
   * import * as NativeScripts from "../../NativeScripts.js"
   *
   * const nativeScript = NativeScripts.makeScriptPubKey(keyHashBytes)
   * const script = Script.fromNativeScript(nativeScript)
   *
   * const tx = await builder
   *   .attachScript({ script })
   *   .mintAssets({ assets: { "<policyId><assetName>": 1000n } })
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly attachScript: (params: { script: Script.Script }) => this

  /**
   * Mint or burn native tokens.
   *
   * Minting creates new tokens, burning destroys existing tokens.
   * - Positive amounts: mint new tokens
   * - Negative amounts: burn existing tokens
   *
   * Can be called multiple times; mints are merged by PolicyId and AssetName.
   * If minting from a script policy, provide the redeemer and attach the script via attachScript().
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * // Mint tokens from a native script policy
   * const tx = await builder
   *   .mintAssets({
   *     assets: {
   *       "<policyId><assetName>": 1000n
   *     }
   *   })
   *   .build()
   *
   * // Mint from Plutus script policy with redeemer
   * const tx = await builder
   *   .attachScript(mintingScript)
   *   .mintAssets({
   *     assets: {
   *       "<policyId><assetName>": 1000n
   *     },
   *     redeemer: myRedeemer
   *   })
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly mintAssets: (params: MintTokensParams) => this

  /**
   * Add reference inputs to the transaction.
   *
   * Reference inputs allow reading UTxO data (datums, reference scripts) without consuming them.
   * They are commonly used to:
   * - Reference validators/scripts stored on-chain (reduces tx size and fees)
   * - Read datum values without spending the UTxO
   * - Share scripts across multiple transactions
   *
   * Reference scripts incur tiered fees based on size:
   * - Tier 1 (0-25KB): 15 lovelace/byte
   * - Tier 2 (25-50KB): 25 lovelace/byte
   * - Tier 3 (50-200KB): 100 lovelace/byte
   * - Maximum: 200KB total limit
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import * as UTxO from "../../UTxO.js"
   *
   * // Use reference script stored on-chain instead of attaching to transaction
   * const refScriptUtxo = await provider.getUtxoByTxHash("abc123...")
   *
   * const tx = await builder
   *   .readFrom({ referenceInputs: [refScriptUtxo] })
   *   .collectFrom({ inputs: [scriptUtxo], redeemer: myRedeemer })
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly readFrom: (params: ReadFromParams) => this

  /**
   * Register a stake credential on-chain.
   *
   * Creates a stake registration certificate, enabling the credential to delegate
   * to pools and receive rewards. Requires paying a stake key deposit (currently 2 ADA).
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly registerStake: (params: RegisterStakeParams) => this

  /**
   * Deregister a stake credential from the chain.
   *
   * Removes the stake credential registration and reclaims the deposit.
   * All rewards must be withdrawn before deregistering.
   *
   * For script-controlled credentials, provide a redeemer. The redeemer can use:
   * - **Static**: Direct Data value
   * - **Self**: Callback receiving the indexed certificate
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly deregisterStake: (params: DeregisterStakeParams) => this

  /**
   * Delegate stake and/or voting power to a pool or DRep.
   *
   * Supports three delegation modes:
   * - **Stake only**: Provide `poolKeyHash` to delegate to a stake pool
   * - **Vote only**: Provide `drep` to delegate governance voting power (Conway)
   * - **Both**: Provide both for combined stake + vote delegation
   *
   * For script-controlled credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @deprecated Use delegateToPool, delegateToDRep, or delegateToPoolAndDRep instead
   * @since 2.0.0
   * @category staking-methods
   */
  readonly delegateTo: (params: DelegateToParams) => this

  /**
   * Delegate stake to a pool.
   *
   * Creates a StakeDelegation certificate to delegate your stake credential
   * to a specific stake pool for earning staking rewards.
   *
   * For script-controlled credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly delegateToPool: (params: DelegateToPoolParams) => this

  /**
   * Delegate voting power to a DRep.
   *
   * Creates a VoteDelegCert certificate to delegate your governance voting power
   * to a Delegated Representative (Conway era).
   *
   * For script-controlled credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly delegateToDRep: (params: DelegateToDRepParams) => this

  /**
   * Delegate both stake and voting power.
   *
   * Creates a StakeVoteDelegCert certificate to simultaneously delegate your
   * stake to a pool and your voting power to a DRep (Conway era).
   *
   * For script-controlled credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly delegateToPoolAndDRep: (params: DelegateToPoolAndDRepParams) => this

  /**
   * Withdraw staking rewards from a stake credential.
   *
   * Withdraws accumulated rewards to the transaction's change address.
   * Use `amount: 0n` to trigger a stake validator without withdrawing rewards
   * (useful for the coordinator pattern).
   *
   * For script-controlled credentials, provide a redeemer. The redeemer can use:
   * - **Static**: Direct Data value
   * - **Self**: Callback receiving the indexed withdrawal
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly withdraw: (params: WithdrawParams) => this

  /**
   * Register a stake credential and delegate in a single certificate.
   *
   * Combines registration and delegation into one certificate, reducing
   * transaction size and fees. Available in Conway era onwards.
   *
   * Supports three delegation modes:
   * - **Stake only**: Provide `poolKeyHash` to register and delegate to pool
   * - **Vote only**: Provide `drep` to register and delegate voting power
   * - **Both**: Provide both for combined registration + delegation
   *
   * For script-controlled credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category staking-methods
   */
  readonly registerAndDelegateTo: (params: RegisterAndDelegateToParams) => this

  /**
   * Register as a Delegated Representative (DRep).
   *
   * Registers a credential as a DRep for governance voting. Requires paying
   * a DRep deposit. Optionally provide an anchor with metadata URL and hash.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly registerDRep: (params: RegisterDRepParams) => this

  /**
   * Update DRep metadata anchor.
   *
   * Updates the anchor (metadata URL + hash) for a registered DRep.
   * For script-controlled DRep credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly updateDRep: (params: UpdateDRepParams) => this

  /**
   * Deregister as a DRep.
   *
   * Removes DRep registration and reclaims the deposit.
   * For script-controlled DRep credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly deregisterDRep: (params: DeregisterDRepParams) => this

  /**
   * Authorize a committee hot credential.
   *
   * Authorizes a hot credential to act on behalf of a cold committee credential.
   * The cold credential is kept offline for security; the hot credential signs
   * governance actions.
   *
   * For script-controlled cold credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly authCommitteeHot: (params: AuthCommitteeHotParams) => this

  /**
   * Resign from the constitutional committee.
   *
   * Submits a resignation from committee membership. Optionally provide
   * an anchor with resignation rationale.
   *
   * For script-controlled cold credentials, provide a redeemer.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly resignCommitteeCold: (params: ResignCommitteeColdParams) => this

  /**
   * Register or update a stake pool.
   *
   * Registers a new stake pool or updates existing pool parameters.
   * Pool parameters include operator key, VRF key, costs, margin, reward account, etc.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category pool-methods
   */
  readonly registerPool: (params: RegisterPoolParams) => this

  /**
   * Retire a stake pool.
   *
   * Announces pool retirement effective at the specified epoch.
   * The pool will continue operating until the retirement epoch.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @since 2.0.0
   * @category pool-methods
   */
  readonly retirePool: (params: RetirePoolParams) => this

  /**
   * Set the transaction validity interval.
   *
   * Configures the time window during which the transaction is valid:
   * - `from`: Transaction is valid after this time (converted to validityIntervalStart slot)
   * - `to`: Transaction expires after this time (converted to ttl slot)
   *
   * Times are Unix timestamps in milliseconds. At least one bound must be specified.
   * For time-locked scripts, `to` is typically required for script evaluation.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import * as Time from "@evolution-sdk/Time"
   *
   * // Transaction valid for 10 minutes from now
   * const tx = await builder
   *   .setValidity({
   *     from: Time.now(),
   *     to: Time.now() + 600_000n  // 10 minutes
   *   })
   *   .build()
   *
   * // Only set expiration (most common)
   * const tx = await builder
   *   .setValidity({ to: Time.now() + 300_000n })  // 5 minute TTL
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category validity-methods
   */
  readonly setValidity: (params: ValidityParams) => this

  /**
   * Submit votes on governance actions.
   *
   * Submits voting procedures to vote on governance proposals. Supports multiple
   * voters voting on multiple proposals in a single transaction.
   *
   * For script-controlled voters (DRep, Constitutional Committee member, or stake pool
   * with script credential), provide a redeemer to satisfy the vote purpose validator.
   * The redeemer will be applied to all script voters in the voting procedures.
   *
   * Use VotingProcedures.singleVote() helper for simple cases or construct
   * VotingProcedures directly for complex multi-voter scenarios.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import * as VotingProcedures from "@evolution-sdk/VotingProcedures"
   * import * as Vote from "@evolution-sdk/Vote"
   * import * as Data from "@evolution-sdk/Data"
   *
   * // Simple single vote with helper
   * await client.newTx()
   *   .vote({
   *     votingProcedures: VotingProcedures.singleVote(
   *       new VotingProcedures.DRepVoter({ credential: myDRepCred }),
   *       govActionId,
   *       new VotingProcedures.VotingProcedure({
   *         vote: Vote.yes(),
   *         anchor: null
   *       })
   *     ),
   *     redeemer: Data.to(new Constr(0, [])) // for script DRep
   *   })
   *   .attachScript({ script: voteScript })
   *   .build()
   *   .then(tx => tx.sign())
   *   .then(tx => tx.submit())
   *
   * // Multiple votes from same voter
   * await client.newTx()
   *   .vote({
   *     votingProcedures: VotingProcedures.multiVote(
   *       new VotingProcedures.DRepVoter({ credential: myDRepCred }),
   *       [
   *         [govActionId1, new VotingProcedures.VotingProcedure({ vote: Vote.yes(), anchor: null })],
   *         [govActionId2, new VotingProcedures.VotingProcedure({ vote: Vote.no(), anchor: null })]
   *       ]
   *     )
   *   })
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly vote: (params: VoteParams) => this

  /**
   * Submit a governance action proposal.
   *
   * Submits a governance action proposal to the blockchain.
   * The deposit (govActionDeposit) is automatically fetched from protocol parameters
   * and will be refunded to the specified reward account when the proposal is finalized.
   *
   * Call .propose() multiple times to submit multiple proposals in one transaction.
   * Consistent with .registerStake() and .registerDRep() - no manual deposit handling.
   *
   * The deposit amount is automatically deducted during transaction balancing.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import * as GovernanceAction from "@evolution-sdk/GovernanceAction"
   * import * as RewardAccount from "@evolution-sdk/RewardAccount"
   *
   * // Submit single proposal (deposit auto-fetched)
   * await client.newTx()
   *   .propose({
   *     governanceAction: new GovernanceAction.InfoAction({}),
   *     rewardAccount: myRewardAccount,
   *     anchor: myAnchor // or null
   *   })
   *   .build()
   *   .then(tx => tx.sign())
   *   .then(tx => tx.submit())
   *
   * // Multiple proposals in one transaction
   * await client.newTx()
   *   .propose({
   *     governanceAction: new GovernanceAction.InfoAction({}),
   *     rewardAccount: myRewardAccount,
   *     anchor: null
   *   })
   *   .propose({
   *     governanceAction: new GovernanceAction.NoConfidenceAction({ govActionId: null }),
   *     rewardAccount: myRewardAccount,
   *     anchor: myOtherAnchor
   *   })
   *   .build()
   *   .then(tx => tx.sign())
   *   .then(tx => tx.submit())
   * ```
   *
   * @since 2.0.0
   * @category governance-methods
   */
  readonly propose: (params: ProposeParams) => this

  /**
   * Add a required signer to the transaction.
   *
   * Adds a key hash to the transaction's requiredSigners field. This is used to
   * require specific key signatures even when those keys don't control inputs.
   * Common use cases include:
   * - Multi-sig schemes requiring explicit signature verification
   * - Plutus scripts that check for specific signers in the transaction
   * - Governance transactions requiring DRep or committee member signatures
   *
   * Duplicate key hashes are automatically deduplicated.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import * as KeyHash from "@evolution-sdk/KeyHash"
   * import * as Address from "@evolution-sdk/Address"
   *
   * // Add signer from address credential
   * const address = Address.fromBech32("addr_test1...")
   * const cred = address.paymentCredential
   * if (cred._tag === "KeyHash") {
   *   const tx = await builder
   *     .addSigner({ keyHash: cred })
   *     .build()
   * }
   * ```
   *
   * @since 2.0.0
   * @category builder-methods
   */
  readonly addSigner: (params: AddSignerParams) => this

  /**
   * Attach metadata to the transaction.
   *
   * Metadata is stored in the auxiliary data section and identified by numeric labels
   * following the CIP-10 standard. Common use cases include:
   * - Transaction messages/comments (label 674, CIP-20)
   * - NFT metadata (label 721, CIP-25)
   * - Royalty information (label 777, CIP-27)
   * - DApp-specific data
   *
   * Multiple metadata entries with different labels can be attached by calling this
   * method multiple times. The same label cannot be used twice.
   *
   * Queues a deferred operation that will be executed when build() is called.
   * Returns the same builder for method chaining.
   *
   * @example
   * ```typescript
   * import { fromEntries } from "@evolution-sdk/evolution/TransactionMetadatum"
   *
   * // Attach a simple message (CIP-20)
   * const tx = await builder
   *   .payToAddress({ address, assets: { lovelace: 2_000_000n } })
   *   .attachMetadata({ label: 674n, metadata: "Hello, Cardano!" })
   *   .build()
   *
   * // Attach NFT metadata (CIP-25)
   * const nftMetadata = fromEntries([
   *   ["name", "My NFT #42"],
   *   ["image", "ipfs://Qm..."]
   * ])
   * const tx = await builder
   *   .mintAssets({ assets: { [policyId + assetName]: 1n } })
   *   .attachMetadata({ label: 721n, metadata: nftMetadata })
   *   .build()
   * ```
   *
   * @since 2.0.0
   * @category metadata-methods
   */
  readonly attachMetadata: (params: AttachMetadataParams) => this

  // ============================================================================
  // Composition Methods
  // ============================================================================

  /**
   * Compose this builder with another builder's accumulated operations.
   *
   * Merges all queued operations from another transaction builder into this one.
   * The other builder's programs are captured at compose time and will be executed
   * when build() is called on this builder.
   *
   * This enables modular transaction building where common patterns can be
   * encapsulated in reusable builder fragments.
   *
   * **Important**: Composition is one-way - changes to the other builder after
   * compose() is called will not affect this builder.
   *
   * @example
   * ```typescript
   * // Create reusable builder for common operations
   * const mintBuilder = builder
   *   .mintAssets({ policyId, assets: { tokenName: 1n }, redeemer })
   *   .attachScript({ script: mintingPolicy })
   *
   * // Compose into a transaction that also pays to an address
   * const tx = await builder
   *   .payToAddress({ address, assets: { lovelace: 5_000_000n } })
   *   .compose(mintBuilder)
   *   .build()
   *
   * // Compose multiple builders
   * const fullTx = await builder
   *   .compose(mintBuilder)
   *   .compose(metadataBuilder)
   *   .compose(certBuilder)
   *   .build()
   * ```
   *
   * @param other - Another transaction builder whose operations will be merged
   *
   * @since 2.0.0
   * @category composition-methods
   */
  readonly compose: (other: TransactionBuilder) => this

  /**
   * Get a snapshot of the accumulated programs.
   *
   * Returns a read-only copy of all queued operations that have been added
   * to this builder. Useful for inspection, debugging, or advanced composition patterns.
   *
   * @since 2.0.0
   * @category composition-methods
   */
  readonly getPrograms: () => ReadonlyArray<ProgramStep>

  // ============================================================================
  // Transaction Chaining Methods
  // ============================================================================

  /**
   * Execute transaction build and return consumed/available UTxOs for chaining.
   *
   * Runs the full build pipeline (coin selection, fee calculation, evaluation) and returns
   * which UTxOs were consumed and which remain available for subsequent transactions.
   * Use this when building multiple dependent transactions in sequence.
   *
   * @example
   * ```typescript
   * // Build first transaction, get remaining UTxOs
   * const tx1 = await builder
   *   .payTo({ address, value: { lovelace: 5_000_000n } })
   *   .build({ availableUtxos: walletUtxos })
   *
   * // Build second transaction using remaining UTxOs from chainResult
   * const tx2 = await builder
   *   .payTo({ address, value: { lovelace: 3_000_000n } })
   *   .build({ availableUtxos: tx1.chainResult().available })
   * ```
   *
   * @since 2.0.0
   * @category chaining-methods
   */
}

/**
 * Transaction builder for signing wallets (SigningWallet or ApiWallet).
 *
 * Builds transactions that can be signed. The build() method returns a SignBuilder
 * which provides sign(), signWithWitness(), and other signing capabilities.
 *
 * This builder type is returned when makeTxBuilder() is called with a signing wallet.
 * Type narrowing happens automatically at construction time - no call-site guards needed.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export interface SigningTransactionBuilder extends TransactionBuilderBase {
  /**
   * Execute all queued operations and return a signing-ready transaction via Promise.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Can be called multiple times on the same builder instance with independent results.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly build: (options?: BuildOptions) => Promise<SignBuilder>

  /**
   * Execute all queued operations and return a signing-ready transaction via Effect.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Suitable for Effect-TS compositional workflows and error handling.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEffect: (
    options?: BuildOptions
  ) => Effect.Effect<
    SignBuilder,
    TransactionBuilderError | EvaluationError | Wallet.WalletError | Provider.ProviderError,
    never
  >

  /**
   * Execute all queued operations with explicit error handling via Either.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Returns `Either<Result, Error>` for pattern-matched error recovery.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEither: (
    options?: BuildOptions
  ) => Promise<
    Either<SignBuilder, TransactionBuilderError | EvaluationError | Wallet.WalletError | Provider.ProviderError>
  >
}

/**
 * Transaction builder for read-only wallets (ReadOnlyWallet or undefined).
 *
 * Builds transactions that cannot be signed. The build() method returns a TransactionResultBase
 * which provides query methods like toTransaction() but NOT signing capabilities.
 *
 * This builder type is returned when makeTxBuilder() is called with a read-only wallet or no wallet.
 * Type narrowing happens automatically at construction time - no call-site guards needed.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export interface ReadOnlyTransactionBuilder extends TransactionBuilderBase {
  /**
   * Execute all queued operations and return a transaction result via Promise.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Can be called multiple times on the same builder instance with independent results.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly build: (options?: BuildOptions) => Promise<TransactionResultBase>

  /**
   * Execute all queued operations and return a transaction result via Effect.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Suitable for Effect-TS compositional workflows and error handling.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEffect: (
    options?: BuildOptions
  ) => Effect.Effect<
    TransactionResultBase,
    TransactionBuilderError | EvaluationError | Wallet.WalletError | Provider.ProviderError,
    never
  >

  /**
   * Execute all queued operations with explicit error handling via Either.
   *
   * Creates fresh state and runs all accumulated ProgramSteps sequentially.
   * Returns `Either<Result, Error>` for pattern-matched error recovery.
   *
   * @since 2.0.0
   * @category completion-methods
   */
  readonly buildEither: (
    options?: BuildOptions
  ) => Promise<
    Either<
      TransactionResultBase,
      TransactionBuilderError | EvaluationError | Wallet.WalletError | Provider.ProviderError
    >
  >
}

/**
 * Union type for all transaction builders.
 * Use specific types (SigningTransactionBuilder or ReadOnlyTransactionBuilder) when you know the wallet type.
 *
 * @since 2.0.0
 * @category builder-interfaces
 */
export type TransactionBuilder = SigningTransactionBuilder | ReadOnlyTransactionBuilder

/**
 * Conditional type to determine the correct TransactionBuilder based on wallet type.
 * - If wallet is SigningWallet or ApiWallet: SigningTransactionBuilder
 * - If wallet is ReadOnlyWallet or undefined: ReadOnlyTransactionBuilder
 *
 * @internal
 */
/**
 * Construct a TransactionBuilder instance from protocol configuration.
 *
 * The builder accumulates chainable method calls as deferred ProgramSteps. Calling build() or chain()
 * creates fresh state (new Refs) and executes all accumulated programs sequentially, ensuring
 * no state pollution between invocations.
 *
 * The return type is narrowed at construction time based on the wallet type provided:
 * - `SigningTransactionBuilder`: when wallet is `SigningWallet` or `ApiWallet`
 * - `ReadOnlyTransactionBuilder`: when wallet is `ReadOnlyWallet` or omitted
 *
 * `chain` is required — use the `mainnet`, `preprod`, or `preview` presets from the client
 * module, or define a custom `Chain` for private networks and devnets.
 *
 * When wallet is omitted, `changeAddress` and `availableUtxos` must be supplied at build
 * time via `BuildOptions`.
 *
 * @since 2.0.0
 * @category constructors
 */
export function makeTxBuilder(
  config: TxBuilderConfig & { wallet: Wallet.SigningWallet | Wallet.ApiWallet }
): SigningTransactionBuilder
export function makeTxBuilder(
  config: TxBuilderConfig & { wallet: Wallet.ReadOnlyWallet }
): ReadOnlyTransactionBuilder
export function makeTxBuilder(config: TxBuilderConfig & { wallet?: undefined }): ReadOnlyTransactionBuilder
export function makeTxBuilder(config: TxBuilderConfig): SigningTransactionBuilder | ReadOnlyTransactionBuilder {
  return BuilderFactory.makeTxBuilder(config)
}
