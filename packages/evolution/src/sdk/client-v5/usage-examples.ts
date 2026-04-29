/**
 * Usage examples and compile-time proofs for Client v5 (Hybrid Design).
 *
 * Each scenario demonstrates which modules/methods are available and uses
 * `@ts-expect-error` to prove that invalid operations fail at compile time.
 *
 * @since experimental
 * @module
 */

import type {
  Client,
  FullProvider,
  UtxoProvider,
  DatumProvider,
  ProtocolProvider,
  SubmissionProvider,
  EvalProvider,
  DelegationProvider,
  Addressable,
  Signable,
  WalletSubmittable,
  UnsignedTx,
  SignedTx,
  ProviderDescriptor,
  WalletDescriptor
} from "./Client.js"

declare const client: {
  <C extends import("./Client.js").Chain>(chain: C): Client<{}>
  <C extends import("./Client.js").Chain, P, W>(
    chain: C,
    config: { readonly provider?: ProviderDescriptor<P>; readonly wallet?: WalletDescriptor<W> }
  ): Client<(unknown extends P ? {} : P) & (unknown extends W ? {} : W)>
}

declare const blockfrost: (config: { baseUrl: string; projectId?: string }) => ProviderDescriptor<FullProvider>
declare const seedWallet: (config: { mnemonic: string }) => WalletDescriptor<Addressable & Signable>
declare const readOnlyWallet: (address: string) => WalletDescriptor<Addressable>
declare const cip30Wallet: (api: unknown) => WalletDescriptor<Addressable & Signable & WalletSubmittable>

declare const preprod: import("./Client.js").Chain & {
  readonly network: "preprod"
}

declare const walletApi: import("./Client.js").WalletApi

// ===========================================================================
// 1. Provider-only — query works, no wallet, no tx
// ===========================================================================

const providerOnly = client(preprod).withBlockfrost({
  baseUrl: "https://cardano-preprod.blockfrost.io/api/v0"
})
// providerOnly is Client<FullProvider>

// Autocomplete: query module is present with all provider methods
providerOnly.query.getUtxos
providerOnly.query.getDatum
providerOnly.query.getProtocolParameters
providerOnly.query.submitTx
providerOnly.query.evaluateTx
providerOnly.query.getDelegation
providerOnly.query.awaitTx

// Effect surface under query.effect
providerOnly.query.effect.getUtxos
providerOnly.query.effect.getDatum
providerOnly.query.effect.getProtocolParameters

// No wallet module — Addressable not present
// @ts-expect-error - wallet module does not exist on provider-only client
providerOnly.wallet

// No tx module — Addressable not present
// @ts-expect-error - tx module does not exist on provider-only client
providerOnly.tx

// ===========================================================================
// 2. Watch-only wallet + provider — address works, tx builds, but no sign
// ===========================================================================

const watchOnly = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withAddress("addr_test1qz...")

// watchOnly is Client<FullProvider & Addressable>

// query module present
watchOnly.query.getUtxos
watchOnly.query.effect.getUtxos

// wallet module present — address methods available
watchOnly.wallet.address
watchOnly.wallet.rewardAddress

// wallet module — no sign (not Signable)
// @ts-expect-error - sign does not exist on watch-only wallet
watchOnly.wallet.signTx

// wallet module — no signMessage (not Signable)
// @ts-expect-error - signMessage does not exist on watch-only wallet
watchOnly.wallet.signMessage

// tx module present (Addressable + UtxoProvider + ProtocolProvider)
watchOnly.tx.newTx
watchOnly.tx.walletUtxos

// Build a transaction — complete works
const watchBuilder = watchOnly.tx.newTx()
watchBuilder.collectFrom
watchBuilder.payToAddress
watchBuilder.build

// After complete, UnsignedTx has no sign() — not Signable
declare const watchUnsigned: UnsignedTx<FullProvider & Addressable>
watchUnsigned.toCBOR
watchUnsigned.toJSON
watchUnsigned.transaction

// @ts-expect-error - sign does not exist on UnsignedTx without Signable
watchUnsigned.sign

// ===========================================================================
// 3. Full signing — complete build -> sign -> submit pipeline
// ===========================================================================

const full = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({
  mnemonic:
    "test test test test test test test test test test test test test test test test test test test test test test test junk"
})

// full is Client<FullProvider & Addressable & Signable>

// All modules present
full.query.getUtxos
full.wallet.address
full.wallet.signTx
full.wallet.signMessage
full.tx.newTx

// Full pipeline: build -> sign -> submit
async function fullPipeline() {
  const result = await full.tx
    .newTx()
    .payToAddress({ address: "addr_test1qz..." as any, assets: { lovelace: 5_000_000n } })
    .build()

  // sign is available
  const signed = await result.sign()

  // submit is available (SubmissionProvider is present)
  const txHash = await signed.submit()
  return txHash
}

// Effect pipeline (buildEffect removed — use build() for now)
function fullPipelineEffect() {
  return full.tx
    .newTx()
    .payToAddress({ address: "addr_test1qz..." as any, assets: { lovelace: 5_000_000n } })
    .build()
  // Effect variant can be discussed later
}

// ===========================================================================
// 4. CIP-30 browser wallet — wallet-side submit
// ===========================================================================

const browser = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withCip30(walletApi)

// browser is Client<FullProvider & Addressable & Signable & WalletSubmittable>

// wallet module has submitTx (WalletSubmittable)
browser.wallet.walletSubmitTx
browser.wallet.signTx
browser.wallet.signMessage

// Full pipeline with CIP-30 submit
async function cip30Pipeline() {
  const result = await browser.tx
    .newTx()
    .payToAddress({ address: "addr_test1qz..." as any, assets: { lovelace: 5_000_000n } })
    .build()

  const signed = await result.sign()

  // submit is available — WalletSubmittable satisfies CanSubmit
  const txHash = await signed.submit()
  return txHash
}

// ===========================================================================
// 5. Provider-only queries without wallet
// ===========================================================================

const queryClient = client(preprod).withKoios({
  baseUrl: "https://api.koios.rest/api/v1"
})

// All query methods available
async function providerQueries() {
  const utxos = await queryClient.query.getUtxos("addr_test1qz..." as any)
  const params = await queryClient.query.getProtocolParameters()
  const d = await queryClient.query.getDatum("hash..." as any)
  return { utxos, params, d }
}

// Effect variants
function providerQueriesEffect() {
  queryClient.query.effect.getUtxos
  queryClient.query.effect.getProtocolParameters
  queryClient.query.effect.getDatum
}

// ===========================================================================
// 6. Wallet-first then provider (order independence)
// ===========================================================================

const walletFirst = client(preprod).withSeed({ mnemonic: "test test ..." }).withBlockfrost({ baseUrl: "https://..." })

// walletFirst is Client<Addressable & Signable & FullProvider>
// Same capabilities regardless of order — all modules present
walletFirst.query.getUtxos
walletFirst.wallet.address
walletFirst.wallet.signTx
walletFirst.tx.newTx

// Prove order independence: same operations work
async function walletFirstPipeline() {
  const result = await walletFirst.tx
    .newTx()
    .payToAddress({ address: "addr_test1qz..." as any, assets: { lovelace: 5_000_000n } })
    .build()

  const signed = await result.sign()
  return signed.submit()
}

// ===========================================================================
// 7. Generic utility functions — structural constraints
// ===========================================================================

/** Any client with UTxO querying and an address. */
async function fetchWalletBalance(c: Client<UtxoProvider & Addressable>) {
  const addr = await c.wallet.address()
  const utxos = await c.query.getUtxos(addr)
  return utxos
}

/** Any client that can build and sign transactions. */
async function buildAndSign(c: Client<UtxoProvider & ProtocolProvider & Addressable & Signable>) {
  const result = await c.tx
    .newTx()
    .payToAddress({ address: "addr_test1qz..." as any, assets: { lovelace: 5_000_000n } })
    .build()
  return result.sign()
}

/** Any client that can query protocol parameters. */
function getParams(c: Client<ProtocolProvider>) {
  // query module is available
  return c.query.getProtocolParameters()
}

/** Any client that can query delegation. */
function getDelegation(c: Client<DelegationProvider & Addressable>) {
  return c.wallet.rewardAddress()
}

// These functions accept the full client since FullProvider extends UtxoProvider
fetchWalletBalance(full)
buildAndSign(full)
getParams(full)
getDelegation(full)

// Also accepts walletFirst (order-independent)
fetchWalletBalance(walletFirst)
buildAndSign(walletFirst)

// ===========================================================================
// 8. Autocomplete proof points
// ===========================================================================

// On Client<{}>: only chain and with*() are visible
const bare = client(preprod)
bare.chain
bare.withBlockfrost
bare.withKoios
bare.withKupmios
bare.withMaestro
bare.withAddress
bare.withSeed
bare.withPrivateKey
bare.withCip30
// No query, wallet, or tx modules
// @ts-expect-error - no query on bare client
bare.query
// @ts-expect-error - no wallet on bare client
bare.wallet
// @ts-expect-error - no tx on bare client
bare.tx

// On Client<FullProvider>: query present, no wallet/tx
// (proven in scenario 1 above)

// On Client<Addressable>: wallet present, no query/tx
const addressOnly = client(preprod).withAddress("addr_test1qz...")
addressOnly.wallet.address
// @ts-expect-error - no query on address-only client (no providers)
addressOnly.query

// ===========================================================================
// 9. Covariance proof — Client<FullProvider & Addressable & Signable>
//    is assignable to Client<UtxoProvider>
// ===========================================================================

// The `out S` variance annotation ensures covariance:
// if S1 extends S2, then Client<S1> is assignable to Client<S2>

function acceptsUtxoClient(_c: Client<UtxoProvider>) {}
function acceptsAddressable(_c: Client<Addressable>) {}
function acceptsMinimalTx(_c: Client<UtxoProvider & ProtocolProvider & Addressable>) {}

// All of these should compile — the full client satisfies narrower constraints
acceptsUtxoClient(full)
acceptsAddressable(full)
acceptsMinimalTx(full)

// Explicit covariance proof with type assertion
type CovarianceProof = Client<FullProvider & Addressable & Signable> extends Client<UtxoProvider> ? true : false

// This line would fail to compile if covariance were broken
const _covarianceOk: CovarianceProof = true

// ===========================================================================
// 10. Additional @ts-expect-error proofs for invalid operations
// ===========================================================================

// Cannot submit without SubmissionProvider or WalletSubmittable
declare const noSubmitSigned: SignedTx<UtxoProvider & ProtocolProvider & Addressable & Signable>
// @ts-expect-error - submit does not exist without SubmissionProvider or WalletSubmittable
noSubmitSigned.submit

// Without ProtocolProvider, tx module exists but build() requires options
declare const noProtocol: Client<UtxoProvider & Addressable>
// tx module is available (Addressable is enough)
noProtocol.tx.newTx()
// But build() requires protocolParameters in options since ProtocolProvider is missing
// noProtocol.tx.newTx().payToAddress({...}).build({ protocolParameters: params })

// ===========================================================================
// 11. PROVIDER COMPOSITION — mix-and-match read vs submission backends
// ===========================================================================

// v5's structural capabilities make custom providers trivial — any object
// that structurally matches UtxoProvider is accepted without brand fields.
//
// declare const koiosReader: (config: { baseUrl: string }) =>
//   <S>(client: Client<S>) => Client<S & UtxoProvider & ProtocolProvider & DatumProvider & DelegationProvider>
//
// declare const customRelay: (config: { url: string }) =>
//   <S>(client: Client<S>) => Client<S & SubmissionProvider>
//
// const composed = client(preprod)
//   .withCustom(koiosReader({ baseUrl: "..." }))   // reads from Koios
//   .withCustom(customRelay({ url: "..." }))        // submits to private relay
//   .withSeed({ mnemonic: "..." })
//
// composed is Client<UtxoProvider & ProtocolProvider & DatumProvider
//                   & DelegationProvider & SubmissionProvider
//                   & Addressable & Signable>

/** Read-only workflow — no submission capability needed. */
async function readOnlyWorkflow(c: Client<UtxoProvider & ProtocolProvider>) {
  const params = await c.query.getProtocolParameters()
  const utxos = await c.query.getUtxos("addr_test1..." as any)
  return { params, utxos }
}

/** Submit-only workflow — e.g. a relay service with pre-built CBOR. */
function submitOnly(c: Client<SubmissionProvider>) {
  return c.query.submitTx("84a400..." as any)
}

// Both work with a full client (superset satisfies each constraint)
readOnlyWorkflow(full)
submitOnly(full)

// ---------------------------------------------------------------------------
// WHY v5 can do this but v3/v4 cannot:
//
// v3: `HasFullProvider` is atomic — you cannot add `HasSubmissionProvider`
//     independently because the brand tag is decoupled from the
//     implementation. There is no way to say "this client can submit
//     but cannot query UTxOs."
//
// v4: QueryModule is monolithic — all query methods arrive as a single
//     block. You cannot attach a custom submission endpoint without
//     also providing (or stubbing) every other query method.
//
// v5 uses structural types with no brand fields. A custom provider only
// needs to match the shape of the capability interface (e.g. an object
// with a `submitTx` method). This makes third-party and user-defined
// providers zero-ceremony — no branded phantom types to satisfy.
// ---------------------------------------------------------------------------

// ===========================================================================
// 12. v1-COMPATIBLE FLAT API — same code as current SDK users write
// ===========================================================================

// v5 exposes v1-compatible flat aliases alongside modules.
// Users don't need to change their code:

async function v1CompatibleCode() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test test ..." })

  // These match v1's API exactly:
  const addr = await c.address()
  const reward = await c.rewardAddress()
  const utxos = await c.getUtxos(addr)
  const walletUtxos = await c.getWalletUtxos()
  const params = await c.getProtocolParameters()
  const delegation = await c.getDelegation("stake_test1..." as any)
  const walletDelegation = await c.getWalletDelegation()

  // Transaction building — same as v1
  const builder = c.newTx()

  // Signing — same as v1
  const witnessSet = await c.signTx({} as any)

  // Effect surface — same as v1
  c.effect

  // BUT users can ALSO use the module API for better organization:
  // c.query.getUtxos(addr)     — namespaced alternative
  // c.wallet.signTx(tx)         — namespaced alternative
  // c.tx.newTx()              — namespaced alternative
  // c.query.effect.getUtxos() — Effect via module
}

// Provider-only client — flat API works too
async function v1CompatibleProviderOnly() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." })

  // v1-compatible flat methods
  const utxos = await c.getUtxos("addr_test1..." as any)
  const params = await c.getProtocolParameters()
  const datum = await c.getDatum("hash..." as any)

  // No wallet methods — compile error just like v1
  // @ts-expect-error - address not available without wallet
  c.address

  // @ts-expect-error - newTx not available without wallet
  c.newTx
}

// ===========================================================================
// 13. BARE CLIENT — nothing works except wiring
// ===========================================================================

function example_bareClient() {
  const bare = client(preprod)

  // Only chain and with* methods available
  bare.chain
  bare.withBlockfrost
  bare.withSeed

  // @ts-expect-error - no query module on bare client
  bare.query
  // @ts-expect-error - no wallet module on bare client
  bare.wallet
  // @ts-expect-error - no tx module on bare client
  bare.tx
  // @ts-expect-error - no newTx on bare client
  bare.newTx
  // @ts-expect-error - no getUtxos on bare client
  bare.getUtxos
  // @ts-expect-error - no signTx on bare client
  bare.signTx
  // @ts-expect-error - no effect on bare client
  bare.effect
}

// ===========================================================================
// 14. OFFLINE TX CONSTRUCTION — no provider, all via BuildOptions
// ===========================================================================

async function example_offlineTx() {
  const offline = client(preprod).withSeed({ mnemonic: "test test ..." })
  // Client<Addressable & Signable> — no provider

  // newTx available (Addressable is enough)
  const builder = offline.newTx()

  // build() without args fails — requirements are unmet (NeedsProtocolProvider | NeedsUtxoProvider)
  // @ts-expect-error - build requires options when provider capabilities are missing
  builder.build()

  // build() with required options satisfies requirements
  const result = await builder
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .build({ protocolParameters: { minFeeA: 44, minFeeB: 155381 } as any, availableUtxos: [] })

  // Result is SignBuilder because wallet is Signable
  const signed = await result.sign()

  // @ts-expect-error - no submit: offline client has no SubmissionProvider or WalletSubmittable
  signed.submit
}

// ===========================================================================
// 15. BUILDER WITH REDEEMER — collectFrom adds EvalProvider requirement
// ===========================================================================

async function example_builderWithRedeemer() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test test ..." })
  // Client<FullProvider & Addressable & Signable>

  // collectFrom WITHOUT redeemer — no extra requirements, build() works
  await c
    .newTx()
    .collectFrom({ inputs: [] as any })
    .build()

  // collectFrom WITH redeemer — adds NeedsEvalProvider
  // But FullProvider includes EvalProvider, so build() still works
  await c
    .newTx()
    .collectFrom({ inputs: [] as any, redeemer: {} })
    .build()
}

declare const noEvalClient: Client<UtxoProvider & ProtocolProvider & Addressable & Signable>

async function example_builderWithRedeemerNoEval() {
  const noEval = noEvalClient

  // collectFrom without redeemer — build() works
  await noEval
    .newTx()
    .collectFrom({ inputs: [] as any })
    .build()

  // collectFrom with redeemer — build() requires evaluator option since EvalProvider is missing
  const redeemerBuilder = noEval.newTx().collectFrom({ inputs: [] as any, redeemer: {} })
  // @ts-expect-error - build without args fails: NeedsEvalProvider unsatisfied
  redeemerBuilder.build()

  // build() with evaluator option satisfies NeedsEvalProvider
  await noEval
    .newTx()
    .collectFrom({ inputs: [] as any, redeemer: {} })
    .build({ evaluator: {} as any })
}

// ===========================================================================
// 16. READ-ONLY WALLET — build for external signing
// ===========================================================================

async function example_readOnlyBuild() {
  const readOnly = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withAddress("addr_test1qz...")
  // Client<FullProvider & Addressable>

  // Can build a transaction
  const result = await readOnly
    .newTx()
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .build()

  // Result is TransactionResult (no Signable), not SignBuilder
  result.toCBOR()
  result.toTransaction()

  // @ts-expect-error - no sign: wallet is read-only
  result.sign
}

// ===========================================================================
// 17. CIP-30 DUAL SUBMIT PATH — wallet vs provider submission
// ===========================================================================

async function example_cip30DualSubmit() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withCip30(walletApi)
  // Client<FullProvider & Addressable & Signable & WalletSubmittable>

  // submit on SignedTx available (SubmissionProvider from provider)
  const result = await c
    .newTx()
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .build()
  const signed = await result.sign()
  await signed.submit() // works via provider's SubmissionProvider

  // wallet.walletSubmitTx also available (WalletSubmittable from CIP-30)
  await c.wallet.walletSubmitTx({} as any)
}

// ===========================================================================
// 18. PRIVATE KEY WALLET — same as seed, different constructor
// ===========================================================================

function example_privateKeyWallet() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withPrivateKey({ paymentKey: "ed25519_sk1..." })
  // Client<FullProvider & Addressable & Signable>

  // Same capabilities as seed wallet
  c.query.getUtxos
  c.wallet.signTx
  c.wallet.signMessage
  c.newTx
}

// ===========================================================================
// 19. PARTIAL BUILD OPTIONS — some from capabilities, some from options
// ===========================================================================

async function example_partialBuildOptions() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test test ..." })

  // Full client: build() returns clean result (all satisfied)
  const result = await c
    .newTx()
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .build()
  result.sign() // works — clean result

  // Optional overrides via options bag (even when already satisfied)
  await c
    .newTx()
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .build({ protocolParameters: { minFeeA: 50, minFeeB: 200000 } as any })

  // Override multiple values via options bag
  await c
    .newTx()
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .build({ protocolParameters: { minFeeA: 50, minFeeB: 200000 } as any, availableUtxos: [] })
}

// ===========================================================================
// 20. SINGLE-CALL CONSTRUCTOR — full config in one shot
// ===========================================================================

function example_singleCallConstructor() {
  // Provider only
  const providerOnly = client(preprod, {
    provider: blockfrost({ baseUrl: "https://..." })
  })
  providerOnly.getUtxos // works
  // @ts-expect-error - no wallet
  providerOnly.address

  // Provider + signing wallet
  const full = client(preprod, {
    provider: blockfrost({ baseUrl: "https://..." }),
    wallet: seedWallet({ mnemonic: "test test ..." })
  })
  full.getUtxos // works
  full.signTx // works
  full.newTx // works

  // Provider + read-only wallet
  const readOnly = client(preprod, {
    provider: blockfrost({ baseUrl: "https://..." }),
    wallet: readOnlyWallet("addr_test1qz...")
  })
  readOnly.getUtxos // works
  readOnly.address // works
  // @ts-expect-error - no signTx on read-only wallet
  readOnly.signTx

  // Provider + CIP-30 wallet
  const cip30 = client(preprod, {
    provider: blockfrost({ baseUrl: "https://..." }),
    wallet: cip30Wallet({})
  })
  cip30.signTx // works
  cip30.wallet.walletSubmitTx // works (WalletSubmittable)

  // Wallet only (no provider)
  const walletOnly = client(preprod, {
    wallet: seedWallet({ mnemonic: "test test ..." })
  })
  walletOnly.signTx // works
  walletOnly.newTx // works (Addressable)
  // @ts-expect-error - no query module without provider
  walletOnly.query

  // Equivalent to progressive: same capabilities, same type
  const progressive = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test test ..." })
  // Both `full` and `progressive` have the same capabilities
}

// ===========================================================================
// 21. MINT WITH REDEEMER — adds NeedsEvalProvider like collectFrom
// ===========================================================================

async function example_mintWithRedeemer() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test..." })

  // Mint without redeemer — no extra requirements
  await c.newTx().mintAssets({ policyId: "abc", assets: {} }).build()

  // Mint with redeemer — adds NeedsEvalProvider, but FullProvider has it → still optional
  await c.newTx().mintAssets({ policyId: "abc", assets: {}, redeemer: {} }).build()
}

async function example_mintWithRedeemerNoEval() {
  // Client missing EvalProvider
  const noEval = noEvalClient

  // Mint without redeemer — build() optional
  await noEval.newTx().mintAssets({ policyId: "abc", assets: {} }).build()

  // Mint with redeemer — build() requires evaluator
  // @ts-expect-error - build without evaluator
  noEval.newTx().mintAssets({ policyId: "abc", assets: {}, redeemer: {} }).build()

  // Provide evaluator
  await noEval
    .newTx()
    .mintAssets({ policyId: "abc", assets: {}, redeemer: {} })
    .build({ evaluator: {} as any })
}

// ===========================================================================
// 22. MULTIPLE REDEEMER OPS — R doesn't double-add
// ===========================================================================

async function example_multipleRedeemers() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test..." })

  // Multiple redeemer operations in one chain — R stays the same (union deduplicates)
  await c
    .newTx()
    .collectFrom({ inputs: [] as any, redeemer: {} })
    .mintAssets({ policyId: "abc", assets: {}, redeemer: {} })
    .delegateTo({ poolId: "pool1...", redeemer: {} })
    .build()
  // FullProvider has EvalProvider → build() still optional despite 3 redeemer ops
}

// ===========================================================================
// 23. STANDALONE BUILDER — no client, all via build options
// ===========================================================================

async function example_standaloneBuilder() {
  // A bare client with just Addressable — no provider at all
  const bare = client(preprod).withAddress("addr_test1...")
  const builder = bare.newTx().payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })

  // build() requires protocolParameters + availableUtxos (no provider)
  // @ts-expect-error - missing required options
  builder.build()

  // Provide everything manually
  const result = await builder.build({
    protocolParameters: { minFeeA: 44, minFeeB: 155381 } as any,
    availableUtxos: []
  })

  // Result is TransactionResult (no Signable — address-only wallet)
  result.toCBOR()
  // @ts-expect-error - no sign on address-only wallet
  result.sign
}

// ===========================================================================
// 24. PROTOCOL PLUGINS — DeFi integration pattern
// ===========================================================================

// Protocols create plugin factories that require specific capabilities.
// If the client doesn't have them, TypeScript rejects the plugin creation.

type PluginFactory<MinCaps, Plugin> = (client: Client<MinCaps>) => Plugin

// DEX plugin — requires UtxoProvider & ProtocolProvider & Addressable & Signable
interface DexPlugin {
  readonly swap: (params: { fromAsset: string; toAsset: string; amount: bigint }) => Promise<string>
  readonly addLiquidity: (params: { poolId: string; amountA: bigint; amountB: bigint }) => Promise<string>
}

declare const createDex: PluginFactory<UtxoProvider & ProtocolProvider & Addressable & Signable, DexPlugin>

// Oracle plugin — only needs UtxoProvider (reads oracle datum)
interface OraclePlugin {
  readonly getPrice: (feedId: string) => Promise<bigint>
}

declare const createOracle: PluginFactory<UtxoProvider, OraclePlugin>

function example_protocolPlugins() {
  const full = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test..." })
  const readOnly = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withAddress("addr_test1...")

  // Full client → DEX: compiles (has all required capabilities)
  const dex = createDex(full)
  dex.swap
  dex.addLiquidity

  // Read-only → DEX: fails (missing Signable)
  // @ts-expect-error — dexActions requires Signable
  createDex(readOnly)

  // Both can use Oracle (only needs UtxoProvider)
  const oracle1 = createOracle(full)
  const oracle2 = createOracle(readOnly)
  oracle1.getPrice
  oracle2.getPrice
}

// ===========================================================================
// 25. DEFI FLOW — script interaction (swap-like pattern)
// ===========================================================================

async function example_defiSwap() {
  const c = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withSeed({ mnemonic: "test..." })

  // A DEX swap: collect from script UTxO with redeemer, pay back to script with datum
  // This is the core DeFi pattern — v1's payToAddress supports datum + script params
  const txResult = await c
    .newTx()
    .collectFrom({ inputs: [] as any, redeemer: {} })  // spend from DEX script
    .payToAddress({ address: "addr_script..." as any, assets: { lovelace: 50_000_000n } })  // pay to DEX script (with datum in v1)
    .attachScript({ script: {} })  // attach validator
    .build()

  const signed = await txResult.sign()
  await signed.submit()
}

// ===========================================================================
// 26. MULTI-PARTY — build without signing for external signer
// ===========================================================================

async function example_multiParty() {
  const readOnly = client(preprod).withBlockfrost({ baseUrl: "https://..." }).withAddress("addr_test1...")

  // Build a transaction without signing — for another party to sign
  const txResult = await readOnly
    .newTx()
    .payToAddress({ address: "addr_test1..." as any, assets: { lovelace: 5_000_000n } })
    .addSigner({ credential: {} as any })
    .build()

  // Get the CBOR to pass to external signer
  const cbor = txResult.toCBOR()
  const tx = txResult.toTransaction()

  // @ts-expect-error — no sign: read-only wallet
  txResult.sign
}
