---
title: sdk/provider/Provider.ts
nav_order: 153
parent: Modules
---

## Provider overview

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [Provider (interface)](#provider-interface)
  - [ProviderEffect](#providereffect)
  - [ProviderEffect (interface)](#providereffect-interface)
  - [ProviderError (class)](#providererror-class)

---

# utils

## Provider (interface)

**Signature**

```ts
export interface Provider extends EffectToPromiseAPI<ProviderEffect> {
  // Effect namespace for Effect-based alternatives
  readonly Effect: ProviderEffect
}
```

## ProviderEffect

**Signature**

```ts
export declare const ProviderEffect: Context.Tag<ProviderEffect, ProviderEffect>
```

## ProviderEffect (interface)

**Signature**

```ts
export interface ProviderEffect {
  readonly getProtocolParameters: () => Effect.Effect<ProtocolParameters.ProtocolParameters, ProviderError>
  getUtxos: (addressOrCredential: Address.Address | Credential.Credential) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxosWithUnit: (
    addressOrCredential: Address.Address | Credential.Credential,
    unit: string
  ) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxoByUnit: (unit: string) => Effect.Effect<UTxO, ProviderError>
  readonly getUtxosByOutRef: (outRefs: ReadonlyArray<OutRef.OutRef>) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getDelegation: (
    rewardAddress: RewardAddress.RewardAddress
  ) => Effect.Effect<Delegation.Delegation, ProviderError>
  readonly getDatum: (datumHash: string) => Effect.Effect<string, ProviderError>
  readonly awaitTx: (txHash: string, checkInterval?: number) => Effect.Effect<boolean, ProviderError>
  readonly submitTx: (cbor: string) => Effect.Effect<string, ProviderError>
  readonly evaluateTx: (tx: string, additionalUTxOs?: Array<UTxO>) => Effect.Effect<Array<EvalRedeemer>, ProviderError>
}
```

## ProviderError (class)

**Signature**

```ts
export declare class ProviderError
```
