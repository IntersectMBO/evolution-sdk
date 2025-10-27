---
title: sdk/client/Client.ts
nav_order: 137
parent: Modules
---

## Client overview

// Client module: extracted from WalletNew during Phase 2

---

<h2 class="text-delta">Table of contents</h2>

- [errors](#errors)
  - [ProviderError (class)](#providererror-class)
- [utils](#utils)
  - [ApiWalletClient (type alias)](#apiwalletclient-type-alias)
  - [ApiWalletConfig (interface)](#apiwalletconfig-interface)
  - [BlockfrostConfig (interface)](#blockfrostconfig-interface)
  - [KoiosConfig (interface)](#koiosconfig-interface)
  - [KupmiosConfig (interface)](#kupmiosconfig-interface)
  - [MaestroConfig (interface)](#maestroconfig-interface)
  - [MinimalClient (interface)](#minimalclient-interface)
  - [MinimalClientEffect (interface)](#minimalclienteffect-interface)
  - [NetworkId (type alias)](#networkid-type-alias)
  - [PrivateKeyWalletConfig (interface)](#privatekeywalletconfig-interface)
  - [ProviderConfig (type alias)](#providerconfig-type-alias)
  - [ProviderOnlyClient (type alias)](#provideronlyclient-type-alias)
  - [ReadOnlyClient (type alias)](#readonlyclient-type-alias)
  - [ReadOnlyClientEffect (interface)](#readonlyclienteffect-interface)
  - [ReadOnlyWalletClient (type alias)](#readonlywalletclient-type-alias)
  - [ReadOnlyWalletConfig (interface)](#readonlywalletconfig-interface)
  - [RetryConfig (interface)](#retryconfig-interface)
  - [RetryPolicy (type alias)](#retrypolicy-type-alias)
  - [RetryPresets](#retrypresets)
  - [SeedWalletConfig (interface)](#seedwalletconfig-interface)
  - [SigningClient (type alias)](#signingclient-type-alias)
  - [SigningClientEffect (interface)](#signingclienteffect-interface)
  - [SigningWalletClient (type alias)](#signingwalletclient-type-alias)
  - [WalletConfig (type alias)](#walletconfig-type-alias)

---

# errors

## ProviderError (class)

Error class for Provider related operations.

**Signature**

```ts
export declare class ProviderError
```

Added in v2.0.0

# utils

## ApiWalletClient (type alias)

ApiWalletClient - can sign and submit via CIP-30, no blockchain queries without provider

**Signature**

```ts
export type ApiWalletClient = EffectToPromiseAPI<ApiWalletEffect> & {
  // No newTx method - cannot build transactions without provider for protocol parameters
  // Combinator methods (pure, no side effects)
  readonly attachProvider: (config: ProviderConfig) => SigningClient
  // Effect namespace - includes all wallet methods as Effects
  readonly Effect: ApiWalletEffect
}
```

## ApiWalletConfig (interface)

**Signature**

```ts
export interface ApiWalletConfig {
  readonly type: "api"
  readonly api: WalletApi // CIP-30 wallet API interface
}
```

## BlockfrostConfig (interface)

**Signature**

```ts
export interface BlockfrostConfig {
  readonly type: "blockfrost"
  readonly baseUrl: string
  readonly projectId?: string
  readonly retryPolicy?: RetryPolicy
}
```

## KoiosConfig (interface)

**Signature**

```ts
export interface KoiosConfig {
  readonly type: "koios"
  readonly baseUrl: string
  readonly token?: string
  readonly retryPolicy?: RetryPolicy
}
```

## KupmiosConfig (interface)

**Signature**

```ts
export interface KupmiosConfig {
  readonly type: "kupmios"
  readonly kupoUrl: string
  readonly ogmiosUrl: string
  readonly headers?: {
    readonly ogmiosHeader?: Record<string, string>
    readonly kupoHeader?: Record<string, string>
  }
  readonly retryPolicy?: RetryPolicy
}
```

## MaestroConfig (interface)

**Signature**

```ts
export interface MaestroConfig {
  readonly type: "maestro"
  readonly baseUrl: string
  readonly apiKey: string
  readonly turboSubmit?: boolean
  readonly retryPolicy?: RetryPolicy
}
```

## MinimalClient (interface)

MinimalClient - starting point, just knows network

**Signature**

```ts
export interface MinimalClient {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects) with type-aware conditional return types
  readonly attachProvider: (config: ProviderConfig) => ProviderOnlyClient
  readonly attachWallet: <T extends WalletConfig>(
    config: T
  ) => T extends SeedWalletConfig
    ? SigningWalletClient
    : T extends PrivateKeyWalletConfig
      ? SigningWalletClient
      : T extends ApiWalletConfig
        ? ApiWalletClient
        : ReadOnlyWalletClient
  readonly attach: <TW extends WalletConfig>(
    providerConfig: ProviderConfig,
    walletConfig: TW
  ) => TW extends SeedWalletConfig
    ? SigningClient
    : TW extends PrivateKeyWalletConfig
      ? SigningClient
      : TW extends ApiWalletConfig
        ? SigningClient
        : ReadOnlyClient
  // Effect namespace for methods with side effects only
  readonly Effect: MinimalClientEffect
}
```

## MinimalClientEffect (interface)

MinimalClient Effect - just holds network context

**Signature**

```ts
export interface MinimalClientEffect {
  readonly networkId: Effect.Effect<number | string, never>
}
```

## NetworkId (type alias)

**Signature**

```ts
export type NetworkId = "mainnet" | "preprod" | "preview" | number
```

## PrivateKeyWalletConfig (interface)

**Signature**

```ts
export interface PrivateKeyWalletConfig {
  readonly type: "private-key"
  readonly paymentKey: string // bech32 ed25519e_sk
  readonly stakeKey?: string // bech32 ed25519e_sk (optional, for Base addresses)
  readonly addressType?: "Base" | "Enterprise"
}
```

## ProviderConfig (type alias)

**Signature**

```ts
export type ProviderConfig = BlockfrostConfig | KupmiosConfig | MaestroConfig | KoiosConfig
```

## ProviderOnlyClient (type alias)

ProviderOnlyClient - can query blockchain and submit transactions

**Signature**

```ts
export type ProviderOnlyClient = EffectToPromiseAPI<Provider.ProviderEffect> & {
  // Combinator methods (pure, no side effects) with type-aware conditional return type
  readonly attachWallet: <T extends WalletConfig>(
    config: T
  ) => T extends SeedWalletConfig
    ? SigningClient
    : T extends PrivateKeyWalletConfig
      ? SigningClient
      : T extends ApiWalletConfig
        ? SigningClient
        : ReadOnlyClient
  // Effect namespace - includes all provider methods as Effects
  readonly Effect: Provider.ProviderEffect
}
```

## ReadOnlyClient (type alias)

ReadOnlyClient - can query blockchain + wallet address operations

ReadOnlyClient cannot sign transactions, so newTx() returns a TransactionBuilder
that yields TransactionResultBase (unsigned transaction only).

**Signature**

````ts
export type ReadOnlyClient = EffectToPromiseAPI<ReadOnlyClientEffect> & {
  /**
   * Create a new transaction builder for read-only operations.
   *
   * Returns a TransactionBuilder that builds unsigned transactions.
   * The build() methods return TransactionResultBase which provides:
   * - `.toTransaction()` - Get the unsigned transaction
   * - `.toTransactionWithFakeWitnesses()` - Get transaction with fake witnesses for fee validation
   * - `.estimateFee()` - Get the calculated fee
   *
   * @param utxos - Optional UTxOs to use for coin selection. If not provided, wallet UTxOs will be fetched automatically when build() is called.
   * @returns A new TransactionBuilder instance configured with cached protocol parameters and wallet change address.
   *
   * @example
   * ```typescript
   * // Build unsigned transaction
   * const result = await readOnlyClient.newTx()
   *   .payToAddress({ address: "addr...", lovelace: 5000000n })
   *   .build()
   *
   * // Get unsigned transaction for external signing
   * const unsignedTx = await result.toTransaction()
   * const txCbor = Transaction.toCBORHex(unsignedTx)
   *
   * // Get fee estimate
   * const fee = await result.estimateFee()
   * ```
   *
   * @since 2.0.0
   * @category transaction-building
   */
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => TransactionBuilder<TransactionResultBase>
  // Effect namespace - includes all provider + wallet methods as Effects
  readonly Effect: ReadOnlyClientEffect
}
````

## ReadOnlyClientEffect (interface)

ReadOnlyClient Effect - Provider + ReadOnlyWallet + transaction builder

**Signature**

```ts
export interface ReadOnlyClientEffect extends Provider.ProviderEffect, ReadOnlyWalletEffect {
  // Note: newTx is defined separately in ReadOnlyClient (not as Effect)
  // Wallet-scoped convenience methods that combine provider + wallet operations
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, Provider.ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, Provider.ProviderError>
}
```

## ReadOnlyWalletClient (type alias)

ReadOnlyWalletClient - address access only, no signing or blockchain access

**Signature**

```ts
export type ReadOnlyWalletClient = EffectToPromiseAPI<ReadOnlyWalletEffect> & {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects)
  readonly attachProvider: (config: ProviderConfig) => ReadOnlyClient
  // Effect namespace - includes all wallet methods as Effects
  readonly Effect: ReadOnlyWalletEffect
}
```

## ReadOnlyWalletConfig (interface)

**Signature**

```ts
export interface ReadOnlyWalletConfig {
  readonly type: "read-only"
  readonly address: string
  readonly rewardAddress?: string
}
```

## RetryConfig (interface)

Preset retry configuration with simple parameters

**Signature**

```ts
export interface RetryConfig {
  readonly maxRetries: number
  readonly retryDelayMs: number
  readonly backoffMultiplier: number
  readonly maxRetryDelayMs: number
}
```

## RetryPolicy (type alias)

Retry policy can be either a preset config or a custom Effect Schedule

**Signature**

```ts
export type RetryPolicy = RetryConfig | Schedule.Schedule<any, any> | { preset: keyof typeof RetryPresets }
```

## RetryPresets

Common preset retry configurations

**Signature**

```ts
export declare const RetryPresets: {
  readonly none: {
    readonly maxRetries: 0
    readonly retryDelayMs: 0
    readonly backoffMultiplier: 1
    readonly maxRetryDelayMs: 0
  }
  readonly fast: {
    readonly maxRetries: 3
    readonly retryDelayMs: 500
    readonly backoffMultiplier: 1.5
    readonly maxRetryDelayMs: 5000
  }
  readonly standard: {
    readonly maxRetries: 3
    readonly retryDelayMs: 1000
    readonly backoffMultiplier: 2
    readonly maxRetryDelayMs: 10000
  }
  readonly aggressive: {
    readonly maxRetries: 5
    readonly retryDelayMs: 1000
    readonly backoffMultiplier: 2
    readonly maxRetryDelayMs: 30000
  }
}
```

## SeedWalletConfig (interface)

**Signature**

```ts
export interface SeedWalletConfig {
  readonly type: "seed"
  readonly mnemonic: string
  readonly accountIndex?: number
  readonly paymentIndex?: number
  readonly stakeIndex?: number
  readonly addressType?: "Base" | "Enterprise"
  readonly password?: string
}
```

## SigningClient (type alias)

SigningClient - full functionality: query blockchain + sign + submit

SigningClient has wallet signing capability, so newTx() returns a TransactionBuilder
that yields SignBuilder (can sign and submit transactions).

**Signature**

````ts
export type SigningClient = EffectToPromiseAPI<SigningClientEffect> & {
  /**
   * Create a new transaction builder with signing capability.
   *
   * Returns a TransactionBuilder that can build and sign transactions.
   * The build() methods return SignBuilder which provides:
   * - `.sign()` - Sign and prepare for submission
   * - `.toTransaction()` - Get the unsigned transaction
   * - `.toTransactionWithFakeWitnesses()` - Get transaction with fake witnesses for fee validation
   * - `.estimateFee()` - Get the calculated fee
   * - `.partialSign()` - Create partial signature for multi-sig
   * - `.assemble()` - Combine multiple signatures
   *
   * UTxOs for coin selection are fetched automatically from the wallet when build() is called.
   * You can override UTxOs per-build using BuildOptions.availableUtxos.
   *
   * @returns A new TransactionBuilder instance configured with cached protocol parameters and wallet change address.
   *
   * @example
   * ```typescript
   * // Build and sign transaction
   * const signBuilder = await signingClient.newTx()
   *   .payToAddress({ address: "addr...", lovelace: 5000000n })
   *   .build()
   *
   * // Sign and submit
   * const submitBuilder = await signBuilder.sign()
   * const txHash = await submitBuilder.submit()
   *
   * // Or get unsigned transaction
   * const unsignedTx = await signBuilder.toTransaction()
   * ```
   *
   * @since 2.0.0
   * @category transaction-building
   */
  readonly newTx: () => TransactionBuilder
  // Effect namespace - includes all provider + wallet methods as Effects
  readonly Effect: SigningClientEffect
}
````

## SigningClientEffect (interface)

SigningClient Effect - Provider + SigningWallet + transaction builder

**Signature**

```ts
export interface SigningClientEffect extends Provider.ProviderEffect, SigningWalletEffect {
  // Note: newTx is defined separately in SigningClient (not as Effect)
  // Wallet-scoped convenience methods that combine provider + wallet operations
  readonly getWalletUtxos: () => Effect.Effect<ReadonlyArray<UTxO.UTxO>, WalletError | Provider.ProviderError>
  readonly getWalletDelegation: () => Effect.Effect<Delegation.Delegation, WalletError | Provider.ProviderError>
}
```

## SigningWalletClient (type alias)

SigningWalletClient - can sign only, no blockchain access

**Signature**

```ts
export type SigningWalletClient = EffectToPromiseAPI<SigningWalletEffect> & {
  readonly networkId: number | string
  // Combinator methods (pure, no side effects)
  readonly attachProvider: (config: ProviderConfig) => SigningClient
  // Effect namespace - includes all wallet methods as Effects
  readonly Effect: SigningWalletEffect
}
```

## WalletConfig (type alias)

**Signature**

```ts
export type WalletConfig = SeedWalletConfig | PrivateKeyWalletConfig | ReadOnlyWalletConfig | ApiWalletConfig
```
