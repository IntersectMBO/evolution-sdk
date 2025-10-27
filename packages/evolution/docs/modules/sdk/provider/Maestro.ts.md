---
title: sdk/provider/Maestro.ts
nav_order: 152
parent: Modules
---

## Maestro overview

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [MaestroProvider (class)](#maestroprovider-class)
    - [getProtocolParameters (property)](#getprotocolparameters-property)
    - [getUtxos (property)](#getutxos-property)
    - [getUtxosWithUnit (property)](#getutxoswithunit-property)
    - [getUtxoByUnit (property)](#getutxobyunit-property)
    - [getUtxosByOutRef (property)](#getutxosbyoutref-property)
    - [getDelegation (property)](#getdelegation-property)
    - [getDatum (property)](#getdatum-property)
    - [awaitTx (property)](#awaittx-property)
    - [submitTx (property)](#submittx-property)
    - [evaluateTx (property)](#evaluatetx-property)
  - [mainnet](#mainnet)
  - [preprod](#preprod)
  - [preview](#preview)

---

# utils

## MaestroProvider (class)

Maestro provider for Cardano blockchain data access.

Supports mainnet and testnet networks with API key authentication.
Features cursor-based pagination and optional turbo submit for faster transaction processing.
Implements rate limiting to respect Maestro API limits.

**Signature**

```ts
export declare class MaestroProvider { constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly turboSubmit: boolean = false
  ) }
```

**Example**

````ts
Basic usage with API key:
```typescript
const maestro = new MaestroProvider(
  "https://api.maestro.org/v1",
  "your-api-key"
);

// Using Promise API
const params = await maestro.getProtocolParameters();

// Using Effect API
const paramsEffect = maestro.Effect.getProtocolParameters;
````

````






**Example**


```ts
With turbo submit enabled:
```typescript
const maestro = new MaestroProvider(
  "https://api.maestro.org/v1",
  "your-api-key",
  true // Enable turbo submit
);

// Transactions will use turbo submit endpoint
const txHash = await maestro.submitTx(signedTx);
````

````






**Example**


```ts
Testnet usage:
```typescript
const maestro = new MaestroProvider(
  "https://preprod.api.maestro.org/v1",
  "your-preprod-api-key"
);
````

````






### Effect (property)





**Signature**


```ts
readonly Effect: ProviderEffect
````

### getProtocolParameters (property)

**Signature**

```ts
getProtocolParameters: () => Promise<ProtocolParameters>
```

### getUtxos (property)

**Signature**

```ts
getUtxos: (addressOrCredential: Parameters<Provider["getUtxos"]>[0]) => Promise<UTxO[]>
```

### getUtxosWithUnit (property)

**Signature**

```ts
getUtxosWithUnit: (
  addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
  unit: Parameters<Provider["getUtxosWithUnit"]>[1]
) => Promise<UTxO[]>
```

### getUtxoByUnit (property)

**Signature**

```ts
getUtxoByUnit: (unit: Parameters<Provider["getUtxoByUnit"]>[0]) => Promise<UTxO>
```

### getUtxosByOutRef (property)

**Signature**

```ts
getUtxosByOutRef: (outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]) => Promise<UTxO[]>
```

### getDelegation (property)

**Signature**

```ts
getDelegation: (rewardAddress: Parameters<Provider["getDelegation"]>[0]) => Promise<Delegation>
```

### getDatum (property)

**Signature**

```ts
getDatum: (datumHash: Parameters<Provider["getDatum"]>[0]) => Promise<string>
```

### awaitTx (property)

**Signature**

```ts
awaitTx: (txHash: Parameters<Provider["awaitTx"]>[0], checkInterval?: Parameters<Provider["awaitTx"]>[1]) =>
  Promise<boolean>
```

### submitTx (property)

**Signature**

```ts
submitTx: (cbor: Parameters<Provider["submitTx"]>[0]) => Promise<string>
```

### evaluateTx (property)

**Signature**

```ts
evaluateTx: (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
  Promise<EvalRedeemer[]>
```

## mainnet

Pre-configured Maestro provider for Cardano mainnet

**Signature**

```ts
export declare const mainnet: (apiKey: string, turboSubmit?: boolean) => MaestroProvider
```

## preprod

Pre-configured Maestro provider for Cardano preprod testnet

**Signature**

```ts
export declare const preprod: (apiKey: string, turboSubmit?: boolean) => MaestroProvider
```

## preview

Pre-configured Maestro provider for Cardano preview testnet

**Signature**

```ts
export declare const preview: (apiKey: string, turboSubmit?: boolean) => MaestroProvider
```
