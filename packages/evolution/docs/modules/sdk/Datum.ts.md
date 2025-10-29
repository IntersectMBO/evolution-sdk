---
title: sdk/Datum.ts
nav_order: 146
parent: Modules
---

## Datum overview

Datum types and utilities for handling Cardano transaction data.

This module provides types and functions for working with datum values
that can be attached to UTxOs in Cardano transactions.

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [Datum (type alias)](#datum-type-alias)
  - [equals](#equals)
  - [filterHashes](#filterhashes)
  - [filterInline](#filterinline)
  - [groupByType](#groupbytype)
  - [isDatumHash](#isdatumhash)
  - [isInlineDatum](#isinlinedatum)
  - [makeDatumHash](#makedatumhash)
  - [makeInlineDatum](#makeinlinedatum)
  - [unique](#unique)

---

# utils

## Datum (type alias)

Datum types and utilities for handling Cardano transaction data.

This module provides types and functions for working with datum values
that can be attached to UTxOs in Cardano transactions.

**Signature**

```ts
export type Datum =
  | {
      type: "datumHash"
      hash: string
    }
  | {
      type: "inlineDatum"
      inline: string
    }
```

## equals

**Signature**

```ts
export declare const equals: (a: Datum, b: Datum) => boolean
```

## filterHashes

**Signature**

```ts
export declare const filterHashes: (datums: Array<Datum>) => Array<{ type: "datumHash"; hash: string }>
```

## filterInline

**Signature**

```ts
export declare const filterInline: (datums: Array<Datum>) => Array<{ type: "inlineDatum"; inline: string }>
```

## groupByType

**Signature**

```ts
export declare const groupByType: (datums: Array<Datum>) => {
  hashes: Array<{ type: "datumHash"; hash: string }>
  inline: Array<{ type: "inlineDatum"; inline: string }>
}
```

## isDatumHash

**Signature**

```ts
export declare const isDatumHash: (datum?: Datum) => datum is { type: "datumHash"; hash: string }
```

## isInlineDatum

**Signature**

```ts
export declare const isInlineDatum: (datum?: Datum) => datum is { type: "inlineDatum"; inline: string }
```

## makeDatumHash

**Signature**

```ts
export declare const makeDatumHash: (hash: string) => Datum
```

## makeInlineDatum

**Signature**

```ts
export declare const makeInlineDatum: (inline: string) => Datum
```

## unique

**Signature**

```ts
export declare const unique: (datums: Array<Datum>) => Array<Datum>
```
