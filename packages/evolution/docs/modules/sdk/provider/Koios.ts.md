---

title: sdk/provider/Koios.ts
nav_order: 158
parent: Modules
---

## Koios overview

---

<h2 class="text-delta">Table of contents</h2>

- [constants](#constants)
  - [DEFAULT_REQUEST_TIMEOUT_MS](#default_request_timeout_ms)
  - [EPOCH_PARAMS_TTL_MS](#epoch_params_ttl_ms)
- [constructors](#constructors)
  - [Koios (class)](#koios-class)
    - [effect (property)](#effect-property)
    - [getProtocolParameters (property)](#getprotocolparameters-property)
    - [getTip (property)](#gettip-property)
    - [getUtxos (property)](#getutxos-property)
    - [getUtxosWithUnit (property)](#getutxoswithunit-property)
    - [getUtxoByUnit (property)](#getutxobyunit-property)
    - [getUtxosByOutRef (property)](#getutxosbyoutref-property)
    - [getDelegation (property)](#getdelegation-property)
    - [getDatum (property)](#getdatum-property)
    - [awaitTx (property)](#awaittx-property)
    - [submitTx (property)](#submittx-property)
    - [evaluateTx (property)](#evaluatetx-property)
    - [getUtxosByAsset (property)](#getutxosbyasset-property)
    - [getAccountUtxos (property)](#getaccountutxos-property)
    - [getUtxosOfTransaction (property)](#getutxosoftransaction-property)
    - [getAccountInfo (property)](#getaccountinfo-property)
    - [getProtocolParametersAt (property)](#getprotocolparametersat-property)
    - [getChainParameters (property)](#getchainparameters-property)
    - [getDReps (property)](#getdreps-property)
    - [getDRep (property)](#getdrep-property)
    - [getCommittee (property)](#getcommittee-property)
    - [getPools (property)](#getpools-property)
    - [getPool (property)](#getpool-property)
    - [getTxConfirmations (property)](#gettxconfirmations-property)
    - [getProposals (property)](#getproposals-property)
    - [getProposal (property)](#getproposal-property)
    - [getVotesByDRep (property)](#getvotesbydrep-property)
    - [getVotesByPool (property)](#getvotesbypool-property)
    - [getVotesByCommittee (property)](#getvotesbycommittee-property)
    - [getVotesByProposal (property)](#getvotesbyproposal-property)
- [models](#models)
  - [KoiosOptions (interface)](#koiosoptions-interface)
- [utils](#utils)
  - [epochParamsFresh](#epochparamsfresh)

---

# constants

## DEFAULT_REQUEST_TIMEOUT_MS

The per-request timeout a Koios client uses when a caller sets none.

Re-exported here because `KoiosEffect` is internal: a consumer raising the ceiling wants to say
what it is raising it from.

**Signature**

```ts
export declare const DEFAULT_REQUEST_TIMEOUT_MS: 10000
```

Added in v2.9.0

## EPOCH_PARAMS_TTL_MS

How long a fetched protocol-parameter set stays good for.

Parameters change only at an epoch boundary (~5 days), so a TTL well under an epoch collapses
the per-transaction-build refetch to at most one request per window without ever going stale.
Measured on a device before the cache existed: **11 `/epoch_params` requests inside one
60-second window**, for data that changes once every five days.

**Signature**

```ts
export declare const EPOCH_PARAMS_TTL_MS: number
```

Added in v2.6.0

# constructors

## Koios (class)

Koios provider for Cardano blockchain data access.
Provides support for interacting with the Koios API across multiple environments.

`token` is a bearer token or a function returning one. A function is resolved per request,
so a credential refreshed while the provider lives is picked up without rebuilding it.

`options.requestTimeoutMs` raises or lowers the per-request ceiling — see {@link KoiosOptions}.

**Signature**

```ts
export declare class Koios {
  constructor(baseUrl: string, token?: _Koios.TokenSource, options?: KoiosOptions)
}
```

Added in v2.0.0

### effect (property)

**Signature**

```ts
readonly effect: ProviderEffectWithTip
```

### getProtocolParameters (property)

**Signature**

```ts
getProtocolParameters: () => Promise<ProtocolParameters>
```

### getTip (property)

**Signature**

```ts
getTip: () => Promise<Tip>
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
getDatum: (datumHash: Parameters<Provider["getDatum"]>[0]) => Promise<Data>
```

### awaitTx (property)

**Signature**

```ts
awaitTx: (
  txHash: Parameters<Provider["awaitTx"]>[0],
  checkInterval?: Parameters<Provider["awaitTx"]>[1],
  timeout?: Parameters<Provider["awaitTx"]>[2]
) => Promise<boolean>
```

### submitTx (property)

**Signature**

```ts
submitTx: (tx: Parameters<Provider["submitTx"]>[0]) => Promise<TransactionHash>
```

### evaluateTx (property)

**Signature**

```ts
evaluateTx: (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
  Promise<EvalRedeemer[]>
```

### getUtxosByAsset (property)

**Signature**

```ts
getUtxosByAsset: (unit: string) => Promise<UTxO[]>
```

### getAccountUtxos (property)

**Signature**

```ts
getAccountUtxos: (
  rewardAddress: Parameters<Provider["getDelegation"]>[0],
  options?: { readonly offset?: number; readonly limit?: number }
) => Promise<UTxO[]>
```

### getUtxosOfTransaction (property)

**Signature**

```ts
getUtxosOfTransaction: (txHash: Parameters<Provider["awaitTx"]>[0]) => Promise<UTxO[]>
```

### getAccountInfo (property)

**Signature**

```ts
getAccountInfo: (rewardAddress: Parameters<Provider["getDelegation"]>[0]) => Promise<AccountInfo | null>
```

### getProtocolParametersAt (property)

**Signature**

```ts
getProtocolParametersAt: (epoch: number) => Promise<ProtocolParameters>
```

### getChainParameters (property)

**Signature**

```ts
getChainParameters: () => Promise<ChainParameters>
```

### getDReps (property)

**Signature**

```ts
getDReps: () => Promise<DRepSummary[]>
```

### getDRep (property)

**Signature**

```ts
getDRep: (drepId: string) => Promise<DRepSummary | null>
```

### getCommittee (property)

**Signature**

```ts
getCommittee: () => Promise<CommitteeMember[]>
```

### getPools (property)

**Signature**

```ts
getPools: () => Promise<PoolSummary[]>
```

### getPool (property)

**Signature**

```ts
getPool: (poolId: string) => Promise<PoolSummary | null>
```

### getTxConfirmations (property)

**Signature**

```ts
getTxConfirmations: (txHash: Parameters<Provider["awaitTx"]>[0]) => Promise<number | null>
```

### getProposals (property)

**Signature**

```ts
getProposals: () => Promise<ProposalSummary[]>
```

### getProposal (property)

**Signature**

```ts
getProposal: (proposalId: string) => Promise<ProposalSummary | null>
```

### getVotesByDRep (property)

**Signature**

```ts
getVotesByDRep: (drepId: string) => Promise<VoteRecord[]>
```

### getVotesByPool (property)

**Signature**

```ts
getVotesByPool: (poolId: string) => Promise<VoteRecord[]>
```

### getVotesByCommittee (property)

**Signature**

```ts
getVotesByCommittee: (ccHotId: string) => Promise<VoteRecord[]>
```

### getVotesByProposal (property)

**Signature**

```ts
getVotesByProposal: (proposalId: string) => Promise<VoteRecord[]>
```

# models

## KoiosOptions (interface)

Options a caller can set on a Koios client, beyond its endpoint and credential.

**Signature**

```ts
export interface KoiosOptions {
  /**
   * Per-request timeout, in milliseconds. Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS} (10 s).
   *
   * ⚠️ Raise it when the LINK is slow rather than when a response is large: the ceiling is per
   * request, so a client on a phone over mobile data wants more than one on a fixed line asking
   * for the same bytes. `/address_info` for a busy address measured 764 KB.
   *
   * ⚠️ It does **not** reach the paged query tier (`getAccountUtxos`,
   * `getUtxosByPaymentCredential(s)`, the history reads), which carries no per-request timeout at
   * all — a single ceiling there would bound a whole multi-page walk rather than one request, so
   * it needs per-page placement to mean anything. Named here so the gap is not mistaken for this
   * option covering it.
   */
  readonly requestTimeoutMs?: number
}
```

Added in v2.9.0

# utils

## epochParamsFresh

Whether a parameter set captured at `at` is still fresh at `nowMs`.

**Signature**

```ts
export declare const epochParamsFresh: (at: number, nowMs: number, ttlMs?: number) => boolean
```
