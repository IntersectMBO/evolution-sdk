---
title: sdk/provider/Koios.ts
nav_order: 156
parent: Modules
---

## Koios overview

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [Koios (class)](#koios-class)
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

---

# utils

## Koios (class)

Provides support for interacting with the Koios API

**Signature**

```ts
export declare class Koios {
  constructor(baseUrl: string, token?: string)
}
```

**Example**

````ts
Using the Preprod API URL:
```typescript
const koios = new Koios(
  "https://preview.koios.rest/api/v1", // Preprod Preview Environment
  "optional-bearer-token" // Optional Bearer Token for authentication
);
````

````






**Example**


```ts
Using the Preprod Stable API URL:
```typescript
const koios = new Koios(
  "https://preprod.koios.rest/api/v1", // Preprod Stable Environment
  "optional-bearer-token" // Optional Bearer Token for authentication
);
````

````






**Example**


```ts
Using the Mainnet API URL:
```typescript
const koios = new Koios(
  "https://api.koios.rest/api/v1", // Mainnet Environment
  "optional-bearer-token" // Optional Bearer Token for authentication
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
submitTx: (tx: Parameters<Provider["submitTx"]>[0]) => Promise<string>
```

### evaluateTx (property)

**Signature**

```ts
evaluateTx: (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
  Promise<EvalRedeemer[]>
```
