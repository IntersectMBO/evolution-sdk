---

title: sdk/provider/Mock.ts
nav_order: 161
parent: Modules
---

## Mock overview

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [MockProvider (class)](#mockprovider-class)
    - [ledger (method)](#ledger-method)
    - [owned (method)](#owned-method)
    - [byOutRef (method)](#byoutref-method)
    - [utxoByUnit (method)](#utxobyunit-method)
    - [delegation (method)](#delegation-method)
    - [datum (method)](#datum-method)
    - [submit (method)](#submit-method)
    - [evaluate (method)](#evaluate-method)
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
  - [defaultProtocolParameters](#defaultprotocolparameters)
  - [defaultTip](#defaulttip)
- [model](#model)
  - [MockProviderConfig (interface)](#mockproviderconfig-interface)

---

# constructors

## MockProvider (class)

An in-memory provider: a full {@link Provider} over a UTxO set held in this process.

It exists so that code written against a provider can be tested without a network and
without Docker — `@evolution-sdk/devnet` runs a real node, which a unit test cannot.

It is a ledger rather than a lookup table: `submitTx` computes the real transaction hash,
**rejects an input it does not hold** (unknown, or already spent by an earlier submit),
spends the inputs it does, and adds the outputs as new UTxOs. A build → submit → build
sequence therefore sees the chain it just made, and a double spend fails here the way it
would on a node.

**Signature**

```ts
export declare class MockProvider {
  constructor(config: MockProviderConfig = {})
}
```

**Example**

```typescript
import { MockProvider } from "@evolution-sdk/evolution/sdk/provider/Mock"

const provider = new MockProvider({ utxos: [myUtxo] })
const utxos = await provider.getUtxos(address)
const txHash = await provider.submitTx(signedTx)
```

Added in v2.2.0

### ledger (method)

The current UTxO set, after every transaction submitted so far. Not part of the
provider interface: it is how a test reads the ledger it has been driving.

**Signature**

```ts
ledger(): Array<CoreUTxO.UTxO>
```

### owned (method)

**Signature**

```ts
private owned(
    addressOrCredential: CoreAddress.Address | Credential.Credential
  ): Array<CoreUTxO.UTxO>
```

### byOutRef (method)

**Signature**

```ts
private byOutRef(inputs: ReadonlyArray<TransactionInput.TransactionInput>): Array<CoreUTxO.UTxO>
```

### utxoByUnit (method)

**Signature**

```ts
private utxoByUnit(unit: string): Effect.Effect<CoreUTxO.UTxO, Provider.ProviderError>
```

### delegation (method)

**Signature**

```ts
private delegation(
    rewardAddress: RewardAddress.RewardAddress
  ): Effect.Effect<Provider.Delegation, Provider.ProviderError>
```

### datum (method)

**Signature**

```ts
private datum(datumHash: DatumHash.DatumHash): Effect.Effect<PlutusData.Data, Provider.ProviderError>
```

### submit (method)

**Signature**

```ts
private submit(
    tx: Transaction.Transaction
  ): Effect.Effect<TransactionHash.TransactionHash, Provider.ProviderError>
```

### evaluate (method)

**Signature**

```ts
private evaluate(
    tx: Transaction.Transaction
  ): Effect.Effect<Array<EvalRedeemer>, Provider.ProviderError>
```

### effect (property)

**Signature**

```ts
readonly effect: Provider.ProviderEffectWithTip
```

### getProtocolParameters (property)

**Signature**

```ts
getProtocolParameters: () => Promise<Provider.ProtocolParameters>
```

### getTip (property)

**Signature**

```ts
getTip: () => Promise<Provider.Tip>
```

### getUtxos (property)

**Signature**

```ts
getUtxos: (addressOrCredential: Parameters<Provider.Provider["getUtxos"]>[0]) => Promise<CoreUTxO.UTxO[]>
```

### getUtxosWithUnit (property)

**Signature**

```ts
getUtxosWithUnit: (
  addressOrCredential: Parameters<Provider.Provider["getUtxosWithUnit"]>[0],
  unit: Parameters<Provider.Provider["getUtxosWithUnit"]>[1]
) => Promise<CoreUTxO.UTxO[]>
```

### getUtxoByUnit (property)

**Signature**

```ts
getUtxoByUnit: (unit: Parameters<Provider.Provider["getUtxoByUnit"]>[0]) => Promise<CoreUTxO.UTxO>
```

### getUtxosByOutRef (property)

**Signature**

```ts
getUtxosByOutRef: (outRefs: Parameters<Provider.Provider["getUtxosByOutRef"]>[0]) => Promise<CoreUTxO.UTxO[]>
```

### getDelegation (property)

**Signature**

```ts
getDelegation: (rewardAddress: Parameters<Provider.Provider["getDelegation"]>[0]) => Promise<Provider.Delegation>
```

### getDatum (property)

**Signature**

```ts
getDatum: (datumHash: Parameters<Provider.Provider["getDatum"]>[0]) => Promise<PlutusData.Data>
```

### awaitTx (property)

**Signature**

```ts
awaitTx: (
  txHash: Parameters<Provider.Provider["awaitTx"]>[0],
  checkInterval?: Parameters<Provider.Provider["awaitTx"]>[1],
  timeout?: Parameters<Provider.Provider["awaitTx"]>[2]
) => Promise<boolean>
```

### submitTx (property)

**Signature**

```ts
submitTx: (tx: Parameters<Provider.Provider["submitTx"]>[0]) => Promise<TransactionHash.TransactionHash>
```

### evaluateTx (property)

**Signature**

```ts
evaluateTx: (
  tx: Parameters<Provider.Provider["evaluateTx"]>[0],
  additionalUTxOs?: Parameters<Provider.Provider["evaluateTx"]>[1]
) => Promise<EvalRedeemer[]>
```

## defaultProtocolParameters

Protocol parameters the mock serves when a test does not supply its own.

Mainnet values as of the Conway era. ⚠️ The cost models are **empty**: a mock runs no
Plutus script, and a transaction whose `script_data_hash` must be correct has to be given
the real cost models through {@link MockProviderConfig.protocolParameters}.

**Signature**

```ts
export declare const defaultProtocolParameters: Provider.ProtocolParameters
```

Added in v2.2.0

## defaultTip

The tip the mock reports when a test does not supply one. A fixed point on preprod, well
past every era boundary, so slot arithmetic in a test lands in the current era.

**Signature**

```ts
export declare const defaultTip: Provider.Tip
```

Added in v2.2.0

# model

## MockProviderConfig (interface)

What a {@link MockProvider} is seeded with.

Every field is optional, and an absent field means the mock knows nothing of that kind
rather than that the answer is empty: `getDatum` and `getDelegation` fail for anything not
seeded, exactly as the HTTP providers do, instead of inventing a null delegation.

**Signature**

```ts
export interface MockProviderConfig {
  /** The starting UTxO set. Submitting a transaction spends from it and adds to it. */
  readonly utxos?: ReadonlyArray<CoreUTxO.UTxO>
  /** Served by `getProtocolParameters`. Defaults to {@link defaultProtocolParameters}. */
  readonly protocolParameters?: Provider.ProtocolParameters
  /** Served by `getTip`. Defaults to {@link defaultTip}. */
  readonly tip?: Provider.Tip
  /** Datums reachable by hash, keyed by the datum hash as hex. */
  readonly datums?: Readonly<Record<string, PlutusData.Data>>
  /** Delegation state, keyed by the bech32 reward address. */
  readonly delegations?: Readonly<Record<string, Provider.Delegation>>
  /**
   * What `evaluateTx` returns. A mock does not run Plutus scripts, so there is nothing to
   * compute: with this unset, evaluating a transaction that carries redeemers fails rather
   * than reporting ex-units it did not measure.
   */
  readonly evalRedeemers?: ReadonlyArray<EvalRedeemer>
  /** Transaction hashes, as hex, that `awaitTx` should already consider confirmed. */
  readonly confirmedTxs?: ReadonlyArray<string>

  // ── the chain-wide query tier ──────────────────────────────────────────────
  // Seeding one of these makes the matching optional member EXIST on the mock, and
  // leaving it out makes the member absent. That is deliberate: a consumer that probes
  // before calling has to be testable against a provider that genuinely cannot answer,
  // and a mock that always answers would make every probe look satisfied.

  /** Stake-account state, keyed by bech32 reward address. Served by `getAccountInfo`,
   * which answers `null` for an address not in this map (the chain has not seen it). */
  readonly accounts?: Readonly<Record<string, Provider.AccountInfo>>
  /** Account-level UTxOs, keyed by bech32 reward address. */
  readonly accountUtxos?: Readonly<Record<string, ReadonlyArray<CoreUTxO.UTxO>>>
  /** Served by `getChainParameters`. */
  readonly chainParameters?: Provider.ChainParameters
  /** Served by `getProtocolParametersAt`, keyed by epoch. */
  readonly protocolParametersByEpoch?: Readonly<Record<number, Provider.ProtocolParameters>>
  /** The DRep index. `getDRep` answers `null` for an id not in it. */
  readonly dreps?: ReadonlyArray<Provider.DRepSummary>
  /** The constitutional committee. */
  readonly committee?: ReadonlyArray<Provider.CommitteeMember>
  /** The pool index. `getPool` answers `null` for an id not in it. */
  readonly pools?: ReadonlyArray<Provider.PoolSummary>
  /** The proposal index. `getProposal` answers `null` for an id not in it. */
  readonly proposals?: ReadonlyArray<Provider.ProposalSummary>
  /** Cast votes, keyed by voter id within each role. Each role seeds its own member. */
  readonly votes?: {
    readonly byDRep?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
    readonly byPool?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
    readonly byCommittee?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
    readonly byProposal?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
  }

  // ── the history and discovery tier ─────────────────────────────────────────
  // Same rule as above: seeding one makes the member exist, leaving it out makes it absent.
  // ⚠️ A consumer that reports "history unavailable" when the member is missing can only be
  // tested against a provider that genuinely has none, which is why the default is absence
  // rather than an empty list.

  /**
   * Transaction references, **newest first**. Seeds `getTxsAt` and `getAccountTxs`.
   *
   * ⚠️ Not keyed by address, and the members ignore the addresses they are asked about: an
   * `IndexedTxRef` carries no address, so an indexer's answer cannot be reconstructed per
   * address from one. A test that needs per-address history has to drive the real provider.
   * What this DOES reproduce faithfully is the windowing — `afterBlock`, `beforeBlock`,
   * `order`, `offset` and `limit` — which is what a history walk's correctness turns on.
   */
  readonly txRefs?: ReadonlyArray<Provider.IndexedTxRef>
  /** Structured transactions, keyed by transaction hash as hex. Seeds `getTxInfo`. */
  readonly txs?: Readonly<Record<string, Provider.IndexedTx>>
  /** Raw transaction CBOR, keyed by transaction hash as hex. Seeds `getTxCbor`. */
  readonly txCbor?: Readonly<Record<string, string>>
  /** Historical payment addresses, keyed by bech32 reward address. Seeds `getAccountAddresses`. */
  readonly accountAddresses?: Readonly<Record<string, ReadonlyArray<string>>>
  /** Bech32 addresses the chain has seen. Seeds `getAddressesSeen`. */
  readonly addressesSeen?: ReadonlyArray<string>
  /** Confirmation depth, keyed by transaction hash as hex. Seeds `getTxConfirmations`. */
  readonly txConfirmations?: Readonly<Record<string, number>>
  /** Scripts by hash, as hex. Seeds `getScriptByHash`. */
  readonly scripts?: Readonly<Record<string, { readonly bytesHex: string; readonly version: "V1" | "V2" | "V3" }>>
  /**
   * Whether `resolveOutRefs` exists. The ANSWERS come from the ledger, not from here.
   *
   * ⚠️ This mock is a ledger, so it knows the difference the member is about: an outpoint it
   * holds is `spent: false`, one it held and `submitTx` consumed is `spent: true`, and one it
   * has never seen is simply absent. A lookup table could not tell the second from the third,
   * which is the exact confusion the member exists to resolve.
   */
  readonly resolvesOutRefs?: boolean
}
```

Added in v2.2.0
