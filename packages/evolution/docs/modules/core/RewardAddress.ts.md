---
title: core/RewardAddress.ts
nav_order: 96
parent: Modules
---

## RewardAddress overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [constructors](#constructors)
  - [make](#make)
- [equality](#equality)
  - [equals](#equals)
- [errors](#errors)
  - [RewardAddressError (class)](#rewardaddresserror-class)
- [model](#model)
  - [RewardAddress (type alias)](#rewardaddress-type-alias)
- [predicates](#predicates)
  - [isRewardAddress](#isrewardaddress)
- [schemas](#schemas)
  - [RewardAddress](#rewardaddress)

---

# arbitrary

## arbitrary

FastCheck arbitrary for generating random RewardAddress instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<string & Brand<"RewardAddress">>
```

Added in v2.0.0

# constructors

## make

Smart constructor for RewardAddress that validates and applies branding.

**Signature**

```ts
export declare const make: (a: string, options?: Schema.MakeOptions) => string & Brand<"RewardAddress">
```

Added in v2.0.0

# equality

## equals

Check if two RewardAddress instances are equal.

**Signature**

```ts
export declare const equals: (a: RewardAddress, b: RewardAddress) => boolean
```

Added in v2.0.0

# errors

## RewardAddressError (class)

Error class for RewardAddress related operations.

**Signature**

```ts
export declare class RewardAddressError
```

Added in v2.0.0

# model

## RewardAddress (type alias)

Type representing a reward/stake address string in bech32 format

**Signature**

```ts
export type RewardAddress = typeof RewardAddress.Type
```

Added in v2.0.0

# predicates

## isRewardAddress

Check if the given value is a valid RewardAddress

**Signature**

```ts
export declare const isRewardAddress: (
  u: unknown,
  overrideOptions?: ParseOptions | number
) => u is string & Brand<"RewardAddress">
```

Added in v2.0.0

# schemas

## RewardAddress

Reward address format schema (human-readable addresses)
Following CIP-0019 encoding requirements

**Signature**

```ts
export declare const RewardAddress: Schema.brand<Schema.filter<typeof Schema.String>, "RewardAddress">
```

Added in v2.0.0
