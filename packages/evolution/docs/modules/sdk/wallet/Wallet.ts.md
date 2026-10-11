---

title: sdk/wallet/Wallet.ts
nav_order: 166
parent: Modules
---

## Wallet overview

---

<h2 class="text-delta">Table of contents</h2>

- [errors](#errors)
  - [WalletError (class)](#walleterror-class)
- [model](#model)
  - [ApiWallet (interface)](#apiwallet-interface)
  - [ApiWalletEffect (interface)](#apiwalleteffect-interface)
  - [Network (type alias)](#network-type-alias)
  - [Payload (type alias)](#payload-type-alias)
  - [ReadOnlyWallet (interface)](#readonlywallet-interface)
  - [ReadOnlyWalletEffect (interface)](#readonlywalleteffect-interface)
  - [SignedMessage (interface)](#signedmessage-interface)
  - [SigningWallet (interface)](#signingwallet-interface)
  - [SigningWalletEffect (interface)](#signingwalleteffect-interface)
  - [TransactionSignatureRequest (interface)](#transactionsignaturerequest-interface)
- [utils](#utils)
  - [WalletApi (interface)](#walletapi-interface)

---

# errors

## WalletError (class)

Error class for wallet-related operations.
Represents failures during wallet address retrieval, transaction signing, or message signing.

**Signature**

```ts
export declare class WalletError
```

Added in v2.0.0

# model

## ApiWallet (interface)

API Wallet interface for CIP-30 compatible wallets.
These wallets handle signing and submission internally through the browser extension.
Wraps ApiWalletEffect with promise-based API for browser contexts.

**Signature**

```ts
export interface ApiWallet extends EffectToPromiseAPI<Omit<ApiWalletEffect, "signTxs">> {
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Promise<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>>
  readonly effect: ApiWalletEffect
  readonly api: WalletApi
  readonly type: "api"
}
```

Added in v2.0.0

## ApiWalletEffect (interface)

API Wallet Effect interface for CIP-30 compatible wallets.
Extends signing capabilities with direct transaction submission through wallet API.
API wallets handle both signing and submission through the wallet extension.

**Signature**

```ts
export interface ApiWalletEffect extends ReadOnlyWalletEffect {
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  /**
   * Sign multiple transactions in batch (CIP-103).
   * Falls back to sequential signTx if the wallet doesn't support batch signing.
   *
   * @since 2.2.0
   */
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>, WalletError>
  readonly signMessage: (
    address: CoreAddress.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
  /**
   * Submit transaction directly through the wallet API.
   * API wallets can submit without requiring a separate provider.
   */
  readonly submitTx: (
    tx: Transaction.Transaction | string
  ) => Effect.Effect<TransactionHash.TransactionHash, WalletError>
  /**
   * Fetch the wallet's available UTxOs (CIP-30 `getUtxos`) parsed into typed UTxOs.
   * Reflects the wallet's own view, including UTxOs created by transactions the wallet
   * has submitted, which an external provider may not have indexed yet.
   *
   * @since 2.3.0
   */
  readonly getUtxos: () => Effect.Effect<ReadonlyArray<CoreUTxO.UTxO>, WalletError>
}
```

Added in v2.0.0

## Network (type alias)

Network identifier for wallet operations.
Mainnet for production, Testnet for testing, or Custom for other networks.

**Signature**

```ts
export type Network = "Mainnet" | "Testnet" | "Custom"
```

Added in v2.0.0

## Payload (type alias)

Payload for message signing - either a string or raw bytes.

**Signature**

```ts
export type Payload = string | Uint8Array
```

Added in v2.0.0

## ReadOnlyWallet (interface)

Read-only wallet interface providing access to wallet data without signing capabilities.
Wraps ReadOnlyWalletEffect with promise-based API for browser and non-Effect contexts.

**Signature**

```ts
export interface ReadOnlyWallet extends EffectToPromiseAPI<ReadOnlyWalletEffect> {
  readonly effect: ReadOnlyWalletEffect
  readonly type: "read-only"
}
```

Added in v2.0.0

## ReadOnlyWalletEffect (interface)

Read-only wallet Effect interface providing access to wallet data without signing capabilities.
Suitable for read-only applications that need wallet address information.

**Signature**

```ts
export interface ReadOnlyWalletEffect {
  readonly address: () => Effect.Effect<CoreAddress.Address, WalletError>
  readonly rewardAddress: () => Effect.Effect<RewardAddress.RewardAddress | null, WalletError>
}
```

Added in v2.0.0

## SignedMessage (interface)

Signed message containing the original payload and its cryptographic signature.

**Signature**

```ts
export interface SignedMessage {
  readonly payload: Payload
  readonly signature: string
}
```

Added in v2.0.0

## SigningWallet (interface)

Signing wallet interface with full wallet functionality including transaction signing.
Wraps SigningWalletEffect with promise-based API for browser and non-Effect contexts.

**Signature**

```ts
export interface SigningWallet extends EffectToPromiseAPI<Omit<SigningWalletEffect, "signTxs">> {
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Promise<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>>
  readonly effect: SigningWalletEffect
  readonly type: "signing"
}
```

Added in v2.0.0

## SigningWalletEffect (interface)

Signing wallet Effect interface extending read-only wallet with transaction and message signing.
Sign transaction and message operations require wallet authorization.

**Signature**

```ts
export interface SigningWalletEffect extends ReadOnlyWalletEffect {
  /**
   * Sign a transaction given its structured representation. UTxOs required for correctness
   * (e.g. to determine required signers) must be supplied by the caller (client) and not
   * fetched internally. Reference UTxOs are used to extract required signers from native scripts
   * that are used via reference inputs.
   */
  readonly signTx: (
    tx: Transaction.Transaction | string,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  /**
   * Sign multiple transactions in batch (CIP-103).
   * Falls back to sequential signTx if the wallet doesn't support batch signing.
   *
   * @since 2.2.0
   */
  readonly signTxs: (
    txs: ReadonlyArray<Transaction.Transaction | string>,
    context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO>; referenceUtxos?: ReadonlyArray<CoreUTxO.UTxO> }
  ) => Effect.Effect<ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>, WalletError>
  readonly signMessage: (
    address: CoreAddress.Address | RewardAddress.RewardAddress,
    payload: Payload
  ) => Effect.Effect<SignedMessage, WalletError>
}
```

Added in v2.0.0

## TransactionSignatureRequest (interface)

CIP-103 transaction signature request for batch signing.

**Signature**

```ts
export interface TransactionSignatureRequest {
  readonly cbor: string
  readonly partialSign: boolean
}
```

Added in v2.2.0

# utils

## WalletApi (interface)

**Signature**

```ts
export interface WalletApi {
  getUsedAddresses(): Promise<ReadonlyArray<string>>
  getUnusedAddresses(): Promise<ReadonlyArray<string>>
  getRewardAddresses(): Promise<ReadonlyArray<string>>
  getUtxos(): Promise<ReadonlyArray<string>>
  signTx(txCborHex: string, partialSign: boolean): Promise<string>
  signData(addressHex: string, payload: Payload): Promise<SignedMessage>
  submitTx(txCborHex: string): Promise<string>
  /** CIP-103 standard namespace */
  cip103?: {
    signTxs(requests: ReadonlyArray<TransactionSignatureRequest>): Promise<ReadonlyArray<string>>
  }
  /** Experimental namespace (e.g. Eternl) */
  experimental?: {
    signTxs?(requests: ReadonlyArray<TransactionSignatureRequest>): Promise<ReadonlyArray<string>>
  }
  /** Direct signTxs (some wallets) */
  signTxs?(requests: ReadonlyArray<TransactionSignatureRequest>): Promise<ReadonlyArray<string>>
}
```
