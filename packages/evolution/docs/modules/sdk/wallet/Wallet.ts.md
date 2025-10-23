---
title: sdk/wallet/Wallet.ts
nav_order: 156
parent: Modules
---

## Wallet overview

// Parent imports (../../)

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [Network (type alias)](#network-type-alias)
  - [Payload (type alias)](#payload-type-alias)
  - [SignedMessage (type alias)](#signedmessage-type-alias)
  - [Wallet (interface)](#wallet-interface)
  - [WalletApi (interface)](#walletapi-interface)
  - [makeWalletFromAPI](#makewalletfromapi)
  - [makeWalletFromAddress](#makewalletfromaddress)
  - [makeWalletFromPrivateKey](#makewalletfromprivatekey)
  - [makeWalletFromSeed](#makewalletfromseed)

---

# utils

## Network (type alias)

**Signature**

```ts
export type Network = "Mainnet" | "Testnet" | "Custom"
```

## Payload (type alias)

**Signature**

```ts
export type Payload = string | Uint8Array
```

## SignedMessage (type alias)

**Signature**

```ts
export type SignedMessage = { signature: string; key: string }
```

## Wallet (interface)

**Signature**

```ts
export interface Wallet {
  // UTxO override controls
  overrideUTxOs(utxos: ReadonlyArray<UTxO.UTxO>): void

  // Addresses
  address(): Promise<Address.Address>
  rewardAddress(): Promise<RewardAddress.RewardAddress | null>

  // Chain queries via Provider
  getUtxos(): Promise<ReadonlyArray<UTxO.UTxO>>
  getUtxosCore?(): Promise<unknown> // optional future: core representation helper
  getDelegation(): Promise<Delegation.Delegation>

  // Signing
  signTx(tx: Transaction.Transaction): Promise<TransactionWitnessSet.TransactionWitnessSet>
  signMessage(address: Address.Address | RewardAddress.RewardAddress, payload: Payload): Promise<SignedMessage>

  // Submission
  submitTx(tx: Transaction.Transaction | string): Promise<string>
}
```

## WalletApi (interface)

**Signature**

```ts
export interface WalletApi {
  getUsedAddresses(): Promise<ReadonlyArray<string>>
  getUnusedAddresses(): Promise<ReadonlyArray<string>>
  getRewardAddresses(): Promise<ReadonlyArray<string>>
  getUtxos(): Promise<ReadonlyArray<string>> // CBOR hex
  signTx(txCborHex: string, partialSign: boolean): Promise<string> // CBOR hex witness set
  signData(addressHex: string, payload: Payload): Promise<SignedMessage>
  submitTx(txCborHex: string): Promise<string>
}
```

## makeWalletFromAPI

**Signature**

```ts
export declare function makeWalletFromAPI(provider: Provider.Provider, api: WalletApi): Wallet
```

## makeWalletFromAddress

**Signature**

```ts
export declare function makeWalletFromAddress(
  provider: Provider.Provider,
  _network: Network,
  address: Address.Address,
  utxos: ReadonlyArray<UTxO.UTxO> = []
): Wallet
```

## makeWalletFromPrivateKey

**Signature**

```ts
export declare function makeWalletFromPrivateKey(
  provider: Provider.Provider,
  network: Network,
  privateKeyBech32: string
): Wallet
```

## makeWalletFromSeed

**Signature**

```ts
export declare function makeWalletFromSeed(
  provider: Provider.Provider,
  network: Network,
  seed: string,
  options?: {
    addressType?: "Base" | "Enterprise"
    accountIndex?: number
    password?: string
  }
): Wallet
```
