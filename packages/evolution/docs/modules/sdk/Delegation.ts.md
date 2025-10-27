---
title: sdk/Delegation.ts
nav_order: 141
parent: Modules
---

## Delegation overview

Delegation types and utilities for handling Cardano stake delegation.

This module provides types and functions for working with stake delegation
information, including pool assignments and reward balances.

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [Delegation (interface)](#delegation-interface)
  - [addRewards](#addrewards)
  - [compareByPoolId](#comparebypoolid)
  - [compareByRewards](#comparebyrewards)
  - [contains](#contains)
  - [empty](#empty)
  - [equals](#equals)
  - [filterByPool](#filterbypool)
  - [filterDelegated](#filterdelegated)
  - [filterUndelegated](#filterundelegated)
  - [filterWithRewards](#filterwithrewards)
  - [find](#find)
  - [findByPool](#findbypool)
  - [getAverageRewards](#getaveragerewards)
  - [getMaxRewards](#getmaxrewards)
  - [getMinRewards](#getminrewards)
  - [getTotalRewards](#gettotalrewards)
  - [getUniquePoolIds](#getuniquepoolids)
  - [groupByPool](#groupbypool)
  - [hasRewards](#hasrewards)
  - [hasSamePool](#hassamepool)
  - [isDelegated](#isdelegated)
  - [make](#make)
  - [sortByPoolId](#sortbypoolid)
  - [sortByRewards](#sortbyrewards)
  - [subtractRewards](#subtractrewards)
  - [unique](#unique)

---

# utils

## Delegation (interface)

Delegation types and utilities for handling Cardano stake delegation.

This module provides types and functions for working with stake delegation
information, including pool assignments and reward balances.

**Signature**

```ts
export interface Delegation {
  readonly poolId: string | undefined
  readonly rewards: bigint
}
```

## addRewards

**Signature**

```ts
export declare const addRewards: (delegation: Delegation, additionalRewards: bigint) => Delegation
```

## compareByPoolId

**Signature**

```ts
export declare const compareByPoolId: (a: Delegation, b: Delegation) => number
```

## compareByRewards

**Signature**

```ts
export declare const compareByRewards: (a: Delegation, b: Delegation) => number
```

## contains

**Signature**

```ts
export declare const contains: (delegations: Array<Delegation>, target: Delegation) => boolean
```

## empty

**Signature**

```ts
export declare const empty: () => Delegation
```

## equals

**Signature**

```ts
export declare const equals: (a: Delegation, b: Delegation) => boolean
```

## filterByPool

**Signature**

```ts
export declare const filterByPool: (delegations: Array<Delegation>, poolId: string) => Array<Delegation>
```

## filterDelegated

**Signature**

```ts
export declare const filterDelegated: (delegations: Array<Delegation>) => Array<Delegation>
```

## filterUndelegated

**Signature**

```ts
export declare const filterUndelegated: (delegations: Array<Delegation>) => Array<Delegation>
```

## filterWithRewards

**Signature**

```ts
export declare const filterWithRewards: (delegations: Array<Delegation>) => Array<Delegation>
```

## find

**Signature**

```ts
export declare const find: (
  delegations: Array<Delegation>,
  predicate: (delegation: Delegation) => boolean
) => Delegation | undefined
```

## findByPool

**Signature**

```ts
export declare const findByPool: (delegations: Array<Delegation>, poolId: string) => Delegation | undefined
```

## getAverageRewards

**Signature**

```ts
export declare const getAverageRewards: (delegations: Array<Delegation>) => bigint
```

## getMaxRewards

**Signature**

```ts
export declare const getMaxRewards: (delegations: Array<Delegation>) => bigint
```

## getMinRewards

**Signature**

```ts
export declare const getMinRewards: (delegations: Array<Delegation>) => bigint
```

## getTotalRewards

**Signature**

```ts
export declare const getTotalRewards: (delegations: Array<Delegation>) => bigint
```

## getUniquePoolIds

**Signature**

```ts
export declare const getUniquePoolIds: (delegations: Array<Delegation>) => Array<string>
```

## groupByPool

**Signature**

```ts
export declare const groupByPool: (delegations: Array<Delegation>) => Record<string, Array<Delegation>>
```

## hasRewards

**Signature**

```ts
export declare const hasRewards: (delegation: Delegation) => boolean
```

## hasSamePool

**Signature**

```ts
export declare const hasSamePool: (a: Delegation, b: Delegation) => boolean
```

## isDelegated

**Signature**

```ts
export declare const isDelegated: (delegation: Delegation) => boolean
```

## make

**Signature**

```ts
export declare const make: (poolId: string | undefined, rewards: bigint) => Delegation
```

## sortByPoolId

**Signature**

```ts
export declare const sortByPoolId: (delegations: Array<Delegation>) => Array<Delegation>
```

## sortByRewards

**Signature**

```ts
export declare const sortByRewards: (delegations: Array<Delegation>, ascending?: boolean) => Array<Delegation>
```

## subtractRewards

**Signature**

```ts
export declare const subtractRewards: (delegation: Delegation, rewardsToSubtract: bigint) => Delegation
```

## unique

**Signature**

```ts
export declare const unique: (delegations: Array<Delegation>) => Array<Delegation>
```
