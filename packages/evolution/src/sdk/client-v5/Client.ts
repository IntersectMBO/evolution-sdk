/**
 * Client v5 — Hybrid Design
 *
 * Combines the best of three previous experiments:
 * - v2: Structural capability interfaces with real Effect methods
 * - v3: Conditional intersection `& (T extends X ? { ... } : {})` for clean autocomplete
 * - v4: Module namespacing (`client.query.*`, `client.wallet.*`, `client.tx.*`)
 *
 * Single `Client<out S>` generic where S is an intersection of fine-grained
 * capability interfaces. Modules appear/disappear via conditional intersection.
 * No `never` in autocomplete, no runtime "not implemented".
 *
 * @since experimental
 * @module
 */

import type { Effect } from "effect"

// ---------------------------------------------------------------------------
// Domain types (simplified stand-ins; real SDK imports from sibling modules)
// ---------------------------------------------------------------------------

type Address = string & { readonly _tag: "Address" }
type RewardAddress = string & { readonly _tag: "RewardAddress" }
type UTxO = { readonly input: unknown; readonly output: unknown }
type Transaction = { readonly body: unknown; readonly witnessSet: unknown }
type TransactionHash = string & { readonly _tag: "TransactionHash" }
type TransactionWitnessSet = { readonly vkeys: unknown }
type Data = unknown
type DatumHash = string & { readonly _tag: "DatumHash" }
type EvalRedeemer = { readonly tag: string; readonly index: number }
type Delegation = { readonly poolId: string | null; readonly rewards: bigint }
type ProtocolParameters = {
  readonly minFeeA: number
  readonly minFeeB: number
}
type Credential = { readonly type: string; readonly hash: string }
type TransactionInput = { readonly txHash: string; readonly index: number }
type SignedMessage = { readonly payload: string; readonly signature: string }
type Payload = string | Uint8Array

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** @since experimental @category errors */
export class WalletError {
  readonly _tag = "WalletError"
  constructor(readonly message: string) {}
}

/** @since experimental @category errors */
export class ProviderError {
  readonly _tag = "ProviderError"
  constructor(readonly message: string) {}
}

// ---------------------------------------------------------------------------
// Utility: force TypeScript to expand/flatten a type in tooltips
// ---------------------------------------------------------------------------

type Expand<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => R
  : T extends object
    ? { [K in keyof T]: T[K] }
    : T

/** Convert a single Effect-returning function to Promise-returning. */
type EffectToPromise<T> =
  T extends (...args: infer A) => Effect.Effect<infer R, infer _E, infer _C>
    ? (...args: A) => Promise<R>
    : never

/** Convert all Effect methods in T to Promise methods. Auto-derives Promise surface from Effect. */
type PromiseSurface<T> = {
  readonly [K in keyof T as T[K] extends (...args: any) => Effect.Effect<any, any, any> ? K : never]: EffectToPromise<T[K]>
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

/** @since experimental @category model */
export interface Chain {
  readonly id: number
  readonly name: string
  readonly network: "mainnet" | "preprod" | "preview" | "custom"
}

/** @since experimental @category presets */
export declare const mainnet: Chain & { readonly network: "mainnet" }

/** @since experimental @category presets */
export declare const preprod: Chain & { readonly network: "preprod" }

/** @since experimental @category presets */
export declare const preview: Chain & { readonly network: "preview" }

// ---------------------------------------------------------------------------
// 1. Fine-grained PROVIDER capability interfaces (Effect surface)
//
// Each interface is STRUCTURAL: it contains the real Effect methods that
// serve as both the type tag AND the implementation contract.
// ---------------------------------------------------------------------------

/** @since experimental @category capabilities */
export interface UtxoProvider {
  readonly getUtxos: (
    addressOrCredential: Address | Credential,
  ) => Effect.Effect<ReadonlyArray<UTxO>, ProviderError>
  readonly getUtxosWithUnit: (
    addressOrCredential: Address | Credential,
    unit: string,
  ) => Effect.Effect<ReadonlyArray<UTxO>, ProviderError>
  readonly getUtxoByUnit: (
    unit: string,
  ) => Effect.Effect<UTxO, ProviderError>
  readonly getUtxosByOutRef: (
    inputs: ReadonlyArray<TransactionInput>,
  ) => Effect.Effect<ReadonlyArray<UTxO>, ProviderError>
}

/** @since experimental @category capabilities */
export interface DatumProvider {
  readonly getDatum: (
    datumHash: DatumHash,
  ) => Effect.Effect<Data, ProviderError>
}

/** @since experimental @category capabilities */
export interface ProtocolProvider {
  readonly getProtocolParameters: () => Effect.Effect<
    ProtocolParameters,
    ProviderError
  >
}

/** @since experimental @category capabilities */
export interface SubmissionProvider {
  readonly submitTx: (
    tx: Transaction,
  ) => Effect.Effect<TransactionHash, ProviderError>
  readonly awaitTx: (
    txHash: TransactionHash,
    checkInterval?: number,
    timeout?: number,
  ) => Effect.Effect<boolean, ProviderError>
}

/** @since experimental @category capabilities */
export interface EvalProvider {
  readonly evaluateTx: (
    tx: Transaction,
    additionalUTxOs?: ReadonlyArray<UTxO>,
  ) => Effect.Effect<ReadonlyArray<EvalRedeemer>, ProviderError>
}

/** @since experimental @category capabilities */
export interface DelegationProvider {
  readonly getDelegation: (
    rewardAddress: RewardAddress,
  ) => Effect.Effect<Delegation, ProviderError>
}

/**
 * All provider capabilities combined. Blockfrost, Koios, etc. typically
 * implement every sub-capability.
 *
 * @since experimental
 * @category capabilities
 */
export type FullProvider = UtxoProvider &
  DatumProvider &
  ProtocolProvider &
  SubmissionProvider &
  EvalProvider &
  DelegationProvider

// ---------------------------------------------------------------------------
// 2. Fine-grained WALLET capability interfaces (Effect surface)
// ---------------------------------------------------------------------------

/** @since experimental @category capabilities */
export interface Addressable {
  readonly address: () => Effect.Effect<Address, WalletError>
  readonly rewardAddress: () => Effect.Effect<
    RewardAddress | null,
    WalletError
  >
}

/** @since experimental @category capabilities */
export interface Signable {
  readonly signTx: (
    tx: Transaction | string,
    context?: {
      utxos?: ReadonlyArray<UTxO>
      referenceUtxos?: ReadonlyArray<UTxO>
    },
  ) => Effect.Effect<TransactionWitnessSet, WalletError>
  readonly signMessage: (
    address: Address | RewardAddress,
    payload: Payload,
  ) => Effect.Effect<SignedMessage, WalletError>
}

/**
 * CIP-30 wallets can submit transactions directly via the browser extension.
 *
 * @since experimental
 * @category capabilities
 */
export interface WalletSubmittable {
  readonly walletSubmitTx: (
    tx: Transaction | string,
  ) => Effect.Effect<TransactionHash, WalletError>
}

// ---------------------------------------------------------------------------
// 3. Any-provider union (for query module gating)
// ---------------------------------------------------------------------------

/** At least one provider capability is present. */
type AnyProvider =
  | UtxoProvider
  | DatumProvider
  | ProtocolProvider
  | SubmissionProvider
  | EvalProvider
  | DelegationProvider

/** Either a provider or a wallet can submit. */
type CanSubmit = SubmissionProvider | WalletSubmittable

// ---------------------------------------------------------------------------
// 4. Module types — conditional method sets under namespaces
//
// Each module uses the v3 conditional intersection pattern so methods
// truly disappear from autocomplete when the backing capability is absent.
// ---------------------------------------------------------------------------

// ---- QueryModule --------------------------------------------------------

/**
 * Effect surface for the query module. Uses Pick from capability interfaces —
 * each method is defined ONCE on the capability, not duplicated here.
 *
 * @since experimental
 * @category model
 */
export type QueryModuleEffect<S> = {}
  & (S extends UtxoProvider ? Pick<UtxoProvider, 'getUtxos' | 'getUtxosWithUnit' | 'getUtxoByUnit' | 'getUtxosByOutRef'> : {})
  & (S extends DatumProvider ? Pick<DatumProvider, 'getDatum'> : {})
  & (S extends ProtocolProvider ? Pick<ProtocolProvider, 'getProtocolParameters'> : {})
  & (S extends SubmissionProvider ? Pick<SubmissionProvider, 'submitTx' | 'awaitTx'> : {})
  & (S extends EvalProvider ? Pick<EvalProvider, 'evaluateTx'> : {})
  & (S extends DelegationProvider ? Pick<DelegationProvider, 'getDelegation'> : {})

/**
 * Query module: Promise surface AUTO-DERIVED from Effect surface via PromiseSurface.
 * No manual duplication — methods defined once on capabilities, picked for Effect,
 * then converted to Promise automatically.
 *
 * @since experimental
 * @category model
 */
export type QueryModule<S> = Expand<PromiseSurface<QueryModuleEffect<S>>> & {
  readonly effect: QueryModuleEffect<S>
}

// ---- WalletModule -------------------------------------------------------

/**
 * Effect surface for the wallet module. Uses Pick from capability interfaces.
 *
 * @since experimental
 * @category model
 */
export type WalletModuleEffect<S> = Pick<Addressable, 'address' | 'rewardAddress'>
  & (S extends Signable ? Pick<Signable, 'signTx' | 'signMessage'> : {})
  & (S extends WalletSubmittable ? Pick<WalletSubmittable, 'walletSubmitTx'> : {})

/**
 * Wallet module: Promise surface AUTO-DERIVED from Effect surface.
 *
 * @since experimental
 * @category model
 */
export type WalletModule<S> = Expand<PromiseSurface<WalletModuleEffect<S>>> & {
  readonly effect: WalletModuleEffect<S>
}

// ---- TxModule -----------------------------------------------------------

/**
 * Transaction building module. Available when the client has both
 * an address (Addressable) and minimum provider capabilities
 * (UtxoProvider & ProtocolProvider) for balancing and fee calculation.
 *
 * @since experimental
 * @category model
 */
export interface TxModule<S> {
  /** Start building a new transaction. R starts as {} — no accumulated requirements yet. */
  readonly newTx: () => TxBuilder<S, NeedsProtocolProvider | NeedsUtxoProvider>
  /** Fetch UTxOs belonging to the client wallet (convenience). */
  readonly walletUtxos: () => Promise<ReadonlyArray<UTxO>>
  /** Effect variant of walletUtxos. */
  readonly walletUtxosEffect: () => Effect.Effect<
    ReadonlyArray<UTxO>,
    ProviderError | WalletError
  >
}

// ---------------------------------------------------------------------------
// 5. Pipeline types: TxBuilder<S, R> -> UnsignedTx<S> -> SignedTx<S>
//
// TxBuilder uses two type params: S (client capabilities) and R (accumulated
// requirements from builder methods). UnsignedTx and SignedTx carry only S
// because requirements have been resolved at build() time.
//
// All use the conditional intersection pattern from v3 so methods
// truly disappear when the corresponding capability is absent.
// ---------------------------------------------------------------------------

// ---- Requirement tags (Effect-style union) ----
// Like Effect<A, E, R>, requirements are a UNION of what's needed.
// When all are provided, R = never. When some are missing, R lists them.

/** @since experimental @category requirements */
export interface NeedsProtocolProvider { readonly _tag: "NeedsProtocolProvider" }

/** @since experimental @category requirements */
export interface NeedsUtxoProvider { readonly _tag: "NeedsUtxoProvider" }

/** @since experimental @category requirements */
export interface NeedsEvalProvider { readonly _tag: "NeedsEvalProvider" }


// ---- Resolve unsatisfied requirements ----

/**
 * Distributes over R (union) and filters out requirements that S satisfies.
 * Like Effect: when all requirements are provided, result is `never`.
 */
type ResolveUnsatisfied<S, R> = R extends infer U ? (
  U extends NeedsProtocolProvider ? (S extends ProtocolProvider ? never : U) :
  U extends NeedsUtxoProvider ? (S extends Addressable & UtxoProvider ? never : U) :
  U extends NeedsEvalProvider ? (S extends EvalProvider ? never : U) :
  never
) : never

// ---- Smart BuildOptions derived from R ----

/** All optional overrides a user can provide at build() time. */
interface BuildOptionsBase {
  readonly protocolParameters?: ProtocolParameters
  readonly changeAddress?: Address
  readonly availableUtxos?: ReadonlyArray<UTxO>
  readonly evaluator?: unknown
  readonly coinSelection?: string
  readonly debug?: boolean
}

/** Convert union to intersection. */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

/** Map each unsatisfied requirement to its required field. */
type RequiredField<R> =
  R extends NeedsProtocolProvider ? { readonly protocolParameters: ProtocolParameters } :
  R extends NeedsUtxoProvider ? { readonly availableUtxos: ReadonlyArray<UTxO> } :
  R extends NeedsEvalProvider ? { readonly evaluator: unknown } :
  {}

/** Compute required fields from unsatisfied requirements (intersection of all). */
type RequiredBuildFields<R> = UnionToIntersection<RequiredField<R>>

/** Smart options: required fields from R + optional overrides. */
type SmartBuildOptions<R> = Expand<RequiredBuildFields<R> & Partial<BuildOptionsBase>>

// ---- Build result types ----

type BuildSuccess<S> = S extends Signable ? Expand<SignBuilder<S>> : TransactionResult

interface TransactionResult {
  readonly toTransaction: () => Transaction
  readonly toCBOR: () => string
}

interface SignBuilder<S> {
  readonly sign: () => Promise<Expand<SignedTx<S>>>
  readonly signEffect: () => Effect.Effect<Expand<SignedTx<S>>, WalletError>
  readonly toTransaction: () => Transaction
  readonly toCBOR: () => string
}

// ---- TxBuilder<S, R> ----

/**
 * Capability-aware transaction builder.
 *
 * - `S` = client capabilities (what the client provides)
 * - `R` = accumulated requirements from builder methods (starts `{}`, grows dynamically)
 *
 * Methods that don't add requirements return `TxBuilder<S, R>` unchanged.
 * `collectFrom` with a redeemer returns `TxBuilder<S, R | NeedsEvalProvider>`.
 *
 * `build()` always callable (0 args). Returns a `Pending<Success, R>`:
 * - When R = never (all satisfied): `.execute()` available → Promise<SignBuilder>
 * - When R ≠ never: `.provide("protocolParameters", params)` erases that requirement
 * Like Effect<A, E, R> with provideService/runPromise.
 *
 * @since experimental
 * @category model
 */
export interface TxBuilder<S, R> {
  // v1-compatible builder methods (R unchanged)
  readonly payToAddress: (params: { address: Address; assets: unknown }) => TxBuilder<S, R>
  readonly sendAll: (params: { address: Address }) => TxBuilder<S, R>
  readonly attachScript: (params: { script: unknown }) => TxBuilder<S, R>
  readonly addSigner: (params: { credential: Credential }) => TxBuilder<S, R>
  readonly attachMetadata: (params: { label: number; metadata: unknown }) => TxBuilder<S, R>
  readonly readFrom: (params: { utxos: ReadonlyArray<UTxO> }) => TxBuilder<S, R>
  readonly setValidity: (params: { validFrom?: number; validTo?: number }) => TxBuilder<S, R>
  readonly propose: (params: unknown) => TxBuilder<S, R>

  // Operations with optional redeemer — with redeemer adds NeedsEvalProvider to R
  readonly collectFrom: {
    (params: { inputs: ReadonlyArray<UTxO> }): TxBuilder<S, R>
    (params: { inputs: ReadonlyArray<UTxO>; redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }
  readonly mintAssets: {
    (params: { policyId: string; assets: unknown }): TxBuilder<S, R>
    (params: { policyId: string; assets: unknown; redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }
  readonly delegateTo: {
    (params: { poolId: string }): TxBuilder<S, R>
    (params: { poolId: string; redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }
  readonly registerStake: {
    (params?: {}): TxBuilder<S, R>
    (params: { redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }
  readonly deregisterStake: {
    (params?: {}): TxBuilder<S, R>
    (params: { redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }
  readonly withdraw: {
    (params?: {}): TxBuilder<S, R>
    (params: { redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }
  readonly vote: {
    (params: { voter: unknown; govActionId: unknown; vote: unknown }): TxBuilder<S, R>
    (params: { voter: unknown; govActionId: unknown; vote: unknown; redeemer: unknown }): TxBuilder<S, R | NeedsEvalProvider>
  }

  // build() — v1 compatible: build(options?) → Promise<Result>
  // When R satisfied by S: options is optional (all overrides)
  // When R not satisfied: options is required with specific missing fields
  readonly build: [ResolveUnsatisfied<S, R>] extends [never]
    ? (options?: Expand<Partial<BuildOptionsBase>>) => Promise<BuildSuccess<S>>
    : (options: SmartBuildOptions<ResolveUnsatisfied<S, R>>) => Promise<BuildSuccess<S>>
}

// ---- UnsignedTx<S> (from BuildResult, not directly constructed) ----

/**
 * An unsigned transaction ready for signing.
 * `sign()` appears only when S extends Signable.
 *
 * @since experimental
 * @category model
 */
export type UnsignedTx<S> = {
  readonly transaction: Transaction
  readonly toCBOR: () => string
  readonly toJSON: () => unknown
} & (S extends Signable
  ? {
      readonly sign: () => Promise<Expand<SignedTx<S>>>
      readonly signEffect: () => Effect.Effect<Expand<SignedTx<S>>, WalletError>
    }
  : {})

/**
 * A signed transaction ready for submission.
 * `submit()` appears when S extends SubmissionProvider OR WalletSubmittable.
 *
 * @since experimental
 * @category model
 */
export type SignedTx<S> = {
  readonly transaction: Transaction
  readonly toCBOR: () => string
  readonly toJSON: () => unknown
} & (S extends CanSubmit
  ? {
      readonly submit: () => Promise<TransactionHash>
      readonly submitEffect: () => Effect.Effect<
        TransactionHash,
        ProviderError | WalletError
      >
    }
  : {})

// ---------------------------------------------------------------------------
// 6. Client<out S> — the core type
//
// Always: chain, with*() methods
// Conditional modules via intersection (v3 pattern):
//   - query:  when any provider capability is present
//   - wallet: when Addressable is present
//   - tx:     when Addressable AND (UtxoProvider & ProtocolProvider)
// ---------------------------------------------------------------------------

/**
 * The core client type. `S` is an intersection of zero or more capability
 * interfaces accumulated via `.with*()` builder methods.
 *
 * Modules appear on the client only when the required capabilities are
 * present. Methods within each module are further gated by fine-grained
 * capabilities. The result: autocomplete shows exactly what you can call.
 *
 * @since experimental
 * @category model
 */
export type Client<S> = {
  /** The chain this client is scoped to. */
  readonly chain: Chain

  // ----- Provider wiring (always available) -----

  /** Attach a Blockfrost provider (all provider capabilities). */
  readonly withBlockfrost: (
    config: BlockfrostConfig,
  ) => Client<S & FullProvider>
  /** Attach a Koios provider (all provider capabilities). */
  readonly withKoios: (config: KoiosConfig) => Client<S & FullProvider>
  /** Attach a Kupmios provider (all provider capabilities). */
  readonly withKupmios: (config: KupmiosConfig) => Client<S & FullProvider>
  /** Attach a Maestro provider (all provider capabilities). */
  readonly withMaestro: (config: MaestroConfig) => Client<S & FullProvider>

  // ----- Wallet wiring (always available) -----

  /** Attach a read-only address wallet (can query, cannot sign). */
  readonly withAddress: (
    address: string,
    rewardAddress?: string,
  ) => Client<S & Addressable>
  /** Attach a seed-phrase wallet (can sign offline). */
  readonly withSeed: (
    config: SeedWalletConfig,
  ) => Client<S & Addressable & Signable>
  /** Attach a private-key wallet (can sign offline). */
  readonly withPrivateKey: (
    config: PrivateKeyWalletConfig,
  ) => Client<S & Addressable & Signable>
  /** Attach a CIP-30 browser wallet (can sign + wallet-side submit). */
  readonly withCip30: (
    api: WalletApi,
  ) => Client<S & Addressable & Signable & WalletSubmittable>
}
  // ----- Conditional modules (v3 pattern: truly disappear) -----

  // query module: appears when any provider capability is present
  & (S extends AnyProvider
    ? { readonly query: QueryModule<S> }
    : {})

  // wallet module: appears when Addressable is present
  & (S extends Addressable
    ? { readonly wallet: WalletModule<S> }
    : {})

  // tx module: appears when we have an address. Provider capabilities are
  // checked at build() time via smart BuildOptions — if the provider is
  // missing, build() requires protocolParameters/availableUtxos in options.
  & (S extends Addressable
    ? { readonly tx: TxModule<S> }
    : {})

  // ----- v1-compatible flat aliases (delegate to modules) -----
  // These preserve the existing user-facing API so users don't need to
  // change their code. Modules provide better organization internally,
  // but the flat surface remains for backward compatibility.

  // Provider methods (flat, matching v1)
  & (S extends UtxoProvider
    ? {
        readonly getUtxos: (addressOrCredential: Address | Credential) => Promise<ReadonlyArray<UTxO>>
        readonly getUtxosWithUnit: (addressOrCredential: Address | Credential, unit: string) => Promise<ReadonlyArray<UTxO>>
        readonly getUtxoByUnit: (unit: string) => Promise<UTxO>
        readonly getUtxosByOutRef: (inputs: ReadonlyArray<TransactionInput>) => Promise<ReadonlyArray<UTxO>>
      }
    : {})
  & (S extends DatumProvider
    ? { readonly getDatum: (datumHash: DatumHash) => Promise<Data> }
    : {})
  & (S extends ProtocolProvider
    ? { readonly getProtocolParameters: () => Promise<ProtocolParameters> }
    : {})
  & (S extends SubmissionProvider
    ? {
        readonly submitTx: (tx: Transaction) => Promise<TransactionHash>
        readonly awaitTx: (txHash: TransactionHash, checkInterval?: number, timeout?: number) => Promise<boolean>
      }
    : {})
  & (S extends EvalProvider
    ? { readonly evaluateTx: (tx: Transaction, additionalUTxOs?: ReadonlyArray<UTxO>) => Promise<ReadonlyArray<EvalRedeemer>> }
    : {})
  & (S extends DelegationProvider
    ? { readonly getDelegation: (rewardAddress: RewardAddress) => Promise<Delegation> }
    : {})

  // Wallet methods (flat, matching v1)
  & (S extends Addressable
    ? {
        readonly address: () => Promise<Address>
        readonly rewardAddress: () => Promise<RewardAddress | null>
      }
    : {})
  & (S extends Signable
    ? {
        readonly signTx: (tx: Transaction | string, context?: { utxos?: ReadonlyArray<UTxO>; referenceUtxos?: ReadonlyArray<UTxO> }) => Promise<TransactionWitnessSet>
        readonly signMessage: (address: Address | RewardAddress, payload: Payload) => Promise<SignedMessage>
      }
    : {})

  // Composite wallet+provider methods (flat, matching v1)
  & (S extends Addressable & UtxoProvider
    ? { readonly getWalletUtxos: () => Promise<ReadonlyArray<UTxO>> }
    : {})
  & (S extends Addressable & DelegationProvider
    ? { readonly getWalletDelegation: () => Promise<Delegation> }
    : {})

  // Transaction building (flat, matching v1)
  // Available with just Addressable — missing provider capabilities are
  // handled at build() time via smart BuildOptions.
  & (S extends Addressable
    ? { readonly newTx: () => TxBuilder<S, NeedsProtocolProvider | NeedsUtxoProvider> }
    : {})

  // Aggregated Effect surface (flat, matching v1)
  & (S extends AnyProvider | Addressable
    ? { readonly effect: S }
    : {})

// ---------------------------------------------------------------------------
// 7. Provider constructor configs
// ---------------------------------------------------------------------------

/** @since experimental @category model */
export interface BlockfrostConfig {
  readonly baseUrl: string
  readonly projectId?: string
}

/** @since experimental @category model */
export interface KoiosConfig {
  readonly baseUrl: string
  readonly token?: string
}

/** @since experimental @category model */
export interface KupmiosConfig {
  readonly kupoUrl: string
  readonly ogmiosUrl: string
  readonly headers?: {
    readonly ogmiosHeader?: Record<string, string>
    readonly kupoHeader?: Record<string, string>
  }
}

/** @since experimental @category model */
export interface MaestroConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly turboSubmit?: boolean
}

// ---------------------------------------------------------------------------
// 8. Wallet constructor configs
// ---------------------------------------------------------------------------

/** @since experimental @category model */
export interface SeedWalletConfig {
  readonly mnemonic: string
  readonly accountIndex?: number
  readonly paymentIndex?: number
  readonly stakeIndex?: number
  readonly addressType?: "Base" | "Enterprise"
  readonly password?: string
}

/** @since experimental @category model */
export interface PrivateKeyWalletConfig {
  readonly paymentKey: string
  readonly stakeKey?: string
  readonly addressType?: "Base" | "Enterprise"
}

/** @since experimental @category model */
export interface WalletApi {
  getUsedAddresses(): Promise<ReadonlyArray<string>>
  getUnusedAddresses(): Promise<ReadonlyArray<string>>
  getRewardAddresses(): Promise<ReadonlyArray<string>>
  getUtxos(): Promise<ReadonlyArray<string>>
  signTx(txCborHex: string, partialSign: boolean): Promise<string>
  signData(addressHex: string, payload: Payload): Promise<SignedMessage>
  submitTx(txCborHex: string): Promise<string>
}

// ---------------------------------------------------------------------------
// 9. Provider & wallet descriptors (for single-call constructor)
// ---------------------------------------------------------------------------

/** A provider descriptor carries the capability type it provides. */
export interface ProviderDescriptor<P> {
  /** @internal */ readonly _capabilities: P
}

/** A wallet descriptor carries the capability type it provides. */
export interface WalletDescriptor<W> {
  /** @internal */ readonly _capabilities: W
}

/** Create a Blockfrost provider descriptor. */
export declare const blockfrost: (config: BlockfrostConfig) => ProviderDescriptor<FullProvider>

/** Create a Koios provider descriptor. */
export declare const koios: (config: KoiosConfig) => ProviderDescriptor<FullProvider>

/** Create a Kupmios provider descriptor. */
export declare const kupmios: (config: KupmiosConfig) => ProviderDescriptor<FullProvider>

/** Create a Maestro provider descriptor. */
export declare const maestro: (config: MaestroConfig) => ProviderDescriptor<FullProvider>

/** Create a seed-phrase wallet descriptor. */
export declare const seedWallet: (config: SeedWalletConfig) => WalletDescriptor<Addressable & Signable>

/** Create a private-key wallet descriptor. */
export declare const privateKeyWallet: (config: PrivateKeyWalletConfig) => WalletDescriptor<Addressable & Signable>

/** Create a read-only address wallet descriptor. */
export declare const readOnlyWallet: (address: string, rewardAddress?: string) => WalletDescriptor<Addressable>

/** Create a CIP-30 browser wallet descriptor. */
export declare const cip30Wallet: (api: WalletApi) => WalletDescriptor<Addressable & Signable & WalletSubmittable>

// ---------------------------------------------------------------------------
// 10. Constructor
// ---------------------------------------------------------------------------

/**
 * Create a client scoped to a chain.
 *
 * **Progressive building** (zero or more `.with*()` calls):
 * ```ts
 * const c = client(preprod)
 *   .withBlockfrost({ baseUrl: "..." })
 *   .withSeed({ mnemonic: "..." })
 * ```
 *
 * **Single-call construction** (full config upfront):
 * ```ts
 * const c = client(preprod, {
 *   provider: blockfrost({ baseUrl: "..." }),
 *   wallet: seedWallet({ mnemonic: "..." })
 * })
 * ```
 *
 * Both produce the same `Client<FullProvider & Addressable & Signable>`.
 * The chain literal type is preserved.
 *
 * @since experimental
 * @category constructors
 */
export declare const client: {
  <C extends Chain>(chain: C): Client<{}>
  <C extends Chain, P, W>(
    chain: C,
    config: { readonly provider?: ProviderDescriptor<P>; readonly wallet?: WalletDescriptor<W> }
  ): Client<(unknown extends P ? {} : P) & (unknown extends W ? {} : W)>
}
