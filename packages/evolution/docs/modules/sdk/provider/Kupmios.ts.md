---
title: sdk/provider/Kupmios.ts
nav_order: 147
parent: Modules
---

## Kupmios overview

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [KupmiosProvider (class)](#kupmiosprovider-class)
    - [Effect (property)](#effect-property)
    - [getProtocolParameters (property)](#getprotocolparameters-property)
    - [getUtxos (property)](#getutxos-property)
    - [getUtxosWithUnit (property)](#getutxoswithunit-property)
    - [getUtxoByUnit (property)](#getutxobyunit-property)
    - [getUtxosByOutRef (property)](#getutxosbyoutref-property)
    - [getDelegation (property)](#getdelegation-property)
    - [getDatum (property)](#getdatum-property)
    - [awaitTx (property)](#awaittx-property)
    - [evaluateTx (property)](#evaluatetx-property)
    - [submitTx (property)](#submittx-property)

---

# utils

## KupmiosProvider (class)

Provides support for interacting with both Kupo and Ogmios APIs.

**Signature**

```ts
export declare class KupmiosProvider {
  constructor(
    kupoUrl: string,
    ogmiosUrl: string,
    headers?: {
      ogmiosHeader?: Record<string, string>
      kupoHeader?: Record<string, string>
    }
  )
}
```

**Example**

````ts
Using Local URLs (No Authentication):
```typescript
const kupmios = new KupmiosProvider(
  "http://localhost:1442", // Kupo API URL
  "http://localhost:1337"  // Ogmios API URL
);
````

````






**Example**


```ts
Using Authenticated URLs (No Custom Headers):
```typescript
const kupmios = new KupmiosProvider(
  "https://dmtr_kupoXXX.preprod-v2.kupo-m1.demeter.run", // Kupo Authenticated URL
  "https://dmtr_ogmiosXXX.preprod-v6.ogmios-m1.demeter.run" // Ogmios Authenticated URL
);
````

````






**Example**


```ts
Using Public URLs with Custom Headers:
```typescript
const kupmios = new KupmiosProvider(
  "https://preprod-v2.kupo-m1.demeter.run", // Kupo API URL
  "https://preprod-v6.ogmios-m1.demeter.run", // Ogmios API URL
  {
    kupoHeader: { "dmtr-api-key": "dmtr_kupoXXX" }, // Custom header for Kupo
    ogmiosHeader: { "dmtr-api-key": "dmtr_ogmiosXXX" } // Custom header for Ogmios
  }
);
````

### Effect (property)

**Signature**

```ts
readonly Effect: ProviderEffect
```

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

### evaluateTx (property)

**Signature**

```ts
evaluateTx: (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
  Promise<EvalRedeemer[]>
```

### submitTx (property)

**Signature**

```ts
submitTx: (tx: Parameters<Provider["submitTx"]>[0]) => Promise<string>
```
