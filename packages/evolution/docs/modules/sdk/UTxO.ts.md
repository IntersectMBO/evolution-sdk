---
title: sdk/UTxO.ts
nav_order: 164
parent: Modules
---

## UTxO overview

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [toUTxO](#toutxo)
- [utils](#utils)
  - [TxOutput (interface)](#txoutput-interface)
  - [UTxO (interface)](#utxo-interface)
  - [UTxOSet (type alias)](#utxoset-type-alias)
  - [addAssets](#addassets)
  - [difference](#difference)
  - [equals](#equals)
  - [filter](#filter)
  - [filterByAddress](#filterbyaddress)
  - [filterByAsset](#filterbyasset)
  - [filterByMinLovelace](#filterbyminlovelace)
  - [filterWithDatum](#filterwithdatum)
  - [filterWithScript](#filterwithscript)
  - [find](#find)
  - [findByAddress](#findbyaddress)
  - [findByOutRef](#findbyoutref)
  - [findWithDatumHash](#findwithdatumhash)
  - [findWithMinLovelace](#findwithminlovelace)
  - [fromArray](#fromarray)
  - [getDatumHash](#getdatumhash)
  - [getInlineDatum](#getinlinedatum)
  - [getLovelace](#getlovelace)
  - [getOutRef](#getoutref)
  - [getTotalAssets](#gettotalassets)
  - [getTotalLovelace](#gettotallovelace)
  - [getValue](#getvalue)
  - [hasAssets](#hasassets)
  - [hasDatum](#hasdatum)
  - [hasLovelace](#haslovelace)
  - [hasNativeTokens](#hasnativetokens)
  - [hasScript](#hasscript)
  - [intersection](#intersection)
  - [isEmpty](#isempty)
  - [map](#map)
  - [reduce](#reduce)
  - [removeByOutRef](#removebyoutref)
  - [size](#size)
  - [sortByLovelace](#sortbylovelace)
  - [subtractAssets](#subtractassets)
  - [toArray](#toarray)
  - [union](#union)
  - [withAssets](#withassets)
  - [withDatum](#withdatum)
  - [withScript](#withscript)
  - [withoutDatum](#withoutdatum)
  - [withoutScript](#withoutscript)

---

# constructors

## toUTxO

Convert a TxOutput to a UTxO by adding txHash and outputIndex.
Used after transaction submission when outputs become UTxOs on-chain.

**Signature**

```ts
export declare const toUTxO: (output: TxOutput, txHash: string, outputIndex: number) => UTxO
```

Added in v2.0.0

# utils

## TxOutput (interface)

Transaction output before it's submitted on-chain.
Similar to UTxO but without txHash/outputIndex since those don't exist yet.

**Signature**

```ts
export interface TxOutput {
  address: string
  assets: Assets.Assets
  datumOption?: Datum.Datum
  scriptRef?: Script.Script
}
```

## UTxO (interface)

UTxO (Unspent Transaction Output) - a TxOutput that has been confirmed on-chain
and has a txHash and outputIndex identifying it.

**Signature**

```ts
export interface UTxO extends TxOutput {
  txHash: string
  outputIndex: number
}
```

## UTxOSet (type alias)

**Signature**

```ts
export type UTxOSet = Array<UTxO>
```

## addAssets

**Signature**

```ts
export declare const addAssets: (utxo: UTxO, assets: Assets.Assets) => UTxO
```

## difference

**Signature**

```ts
export declare const difference: (setA: UTxOSet, setB: UTxOSet) => UTxOSet
```

## equals

**Signature**

```ts
export declare const equals: (a: UTxO, b: UTxO) => boolean
```

## filter

**Signature**

```ts
export declare const filter: (utxos: UTxOSet, predicate: (utxo: UTxO) => boolean) => UTxOSet
```

## filterByAddress

**Signature**

```ts
export declare const filterByAddress: (utxoSet: UTxOSet, address: string) => UTxOSet
```

## filterByAsset

**Signature**

```ts
export declare const filterByAsset: (utxoSet: UTxOSet, unit: string) => UTxOSet
```

## filterByMinLovelace

**Signature**

```ts
export declare const filterByMinLovelace: (utxoSet: UTxOSet, minLovelace: bigint) => UTxOSet
```

## filterWithDatum

**Signature**

```ts
export declare const filterWithDatum: (utxoSet: UTxOSet) => UTxOSet
```

## filterWithScript

**Signature**

```ts
export declare const filterWithScript: (utxoSet: UTxOSet) => UTxOSet
```

## find

**Signature**

```ts
export declare const find: (utxos: UTxOSet, predicate: (utxo: UTxO) => boolean) => UTxO | undefined
```

## findByAddress

**Signature**

```ts
export declare const findByAddress: (utxos: UTxOSet, address: string) => UTxOSet
```

## findByOutRef

**Signature**

```ts
export declare const findByOutRef: (utxoSet: UTxOSet, outRef: OutRef.OutRef) => UTxO | undefined
```

## findWithDatumHash

**Signature**

```ts
export declare const findWithDatumHash: (utxos: UTxOSet, hash: string) => UTxOSet
```

## findWithMinLovelace

**Signature**

```ts
export declare const findWithMinLovelace: (utxos: UTxOSet, minLovelace: bigint) => UTxOSet
```

## fromArray

**Signature**

```ts
export declare const fromArray: (utxos: Array<UTxO>) => UTxOSet
```

## getDatumHash

**Signature**

```ts
export declare const getDatumHash: (utxo: UTxO) => string | undefined
```

## getInlineDatum

**Signature**

```ts
export declare const getInlineDatum: (utxo: UTxO) => string | undefined
```

## getLovelace

**Signature**

```ts
export declare const getLovelace: (utxo: UTxO) => bigint
```

## getOutRef

**Signature**

```ts
export declare const getOutRef: (utxo: UTxO) => OutRef.OutRef
```

## getTotalAssets

**Signature**

```ts
export declare const getTotalAssets: (utxoSet: UTxOSet) => Assets.Assets
```

## getTotalLovelace

**Signature**

```ts
export declare const getTotalLovelace: (utxoSet: UTxOSet) => bigint
```

## getValue

**Signature**

```ts
export declare const getValue: (utxo: UTxO) => Assets.Assets
```

## hasAssets

**Signature**

```ts
export declare const hasAssets: (utxo: UTxO) => boolean
```

## hasDatum

**Signature**

```ts
export declare const hasDatum: (utxo: UTxO) => boolean
```

## hasLovelace

**Signature**

```ts
export declare const hasLovelace: (utxo: UTxO) => boolean
```

## hasNativeTokens

**Signature**

```ts
export declare const hasNativeTokens: (utxo: UTxO) => boolean
```

## hasScript

**Signature**

```ts
export declare const hasScript: (utxo: UTxO) => boolean
```

## intersection

**Signature**

```ts
export declare const intersection: (setA: UTxOSet, setB: UTxOSet) => UTxOSet
```

## isEmpty

**Signature**

```ts
export declare const isEmpty: (utxoSet: UTxOSet) => boolean
```

## map

**Signature**

```ts
export declare const map: <T>(utxos: UTxOSet, mapper: (utxo: UTxO) => T) => Array<T>
```

## reduce

**Signature**

```ts
export declare const reduce: <T>(utxos: UTxOSet, reducer: (acc: T, utxo: UTxO) => T, initial: T) => T
```

## removeByOutRef

**Signature**

```ts
export declare const removeByOutRef: (utxoSet: UTxOSet, outRef: OutRef.OutRef) => UTxOSet
```

## size

**Signature**

```ts
export declare const size: (utxoSet: UTxOSet) => number
```

## sortByLovelace

**Signature**

```ts
export declare const sortByLovelace: (utxoSet: UTxOSet, ascending?: boolean) => UTxOSet
```

## subtractAssets

**Signature**

```ts
export declare const subtractAssets: (utxo: UTxO, assets: Assets.Assets) => UTxO
```

## toArray

**Signature**

```ts
export declare const toArray: (utxoSet: UTxOSet) => Array<UTxO>
```

## union

**Signature**

```ts
export declare const union: (setA: UTxOSet, setB: UTxOSet) => UTxOSet
```

## withAssets

**Signature**

```ts
export declare const withAssets: (utxo: UTxO, assets: Assets.Assets) => UTxO
```

## withDatum

**Signature**

```ts
export declare const withDatum: (utxo: UTxO, datumOption: Datum.Datum) => UTxO
```

## withScript

**Signature**

```ts
export declare const withScript: (utxo: UTxO, scriptRef: Script.Script) => UTxO
```

## withoutDatum

**Signature**

```ts
export declare const withoutDatum: (utxo: UTxO) => UTxO
```

## withoutScript

**Signature**

```ts
export declare const withoutScript: (utxo: UTxO) => UTxO
```
