---
title: core/AddressEras.ts
nav_order: 2
parent: Modules
---

## AddressEras overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [effect](#effect)
  - [Either (namespace)](#either-namespace)
- [encoding](#encoding)
  - [toBech32](#tobech32)
  - [toBytes](#tobytes)
  - [toHex](#tohex)
- [model](#model)
  - [AddressEras](#addresseras)
  - [AddressEras (type alias)](#addresseras-type-alias)
  - [AddressError (class)](#addresserror-class)
- [parsing](#parsing)
  - [fromBech32](#frombech32)
  - [fromBytes](#frombytes)
  - [fromHex](#fromhex)
- [schema](#schema)
  - [FromBech32](#frombech32-1)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex-1)
- [utils](#utils)
  - [equals](#equals)
  - [isAddress](#isaddress)

---

# arbitrary

## arbitrary

FastCheck arbitrary for Address instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<
  | RewardAccount.RewardAccount
  | BaseAddress.BaseAddress
  | EnterpriseAddress.EnterpriseAddress
  | PointerAddress.PointerAddress
>
```

Added in v2.0.0

# effect

## Either (namespace)

Effect-based error handling variants for functions that can fail.

Added in v2.0.0

# encoding

## toBech32

Convert an Address to Bech32 string.

**Signature**

```ts
export declare const toBech32: (
  input:
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress
) => string
```

Added in v2.0.0

## toBytes

Convert an Address to bytes.

**Signature**

```ts
export declare const toBytes: (
  input:
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress
) => any
```

Added in v2.0.0

## toHex

Convert an Address to hex string.

**Signature**

```ts
export declare const toHex: (
  input:
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress
) => string
```

Added in v2.0.0

# model

## AddressEras

Union type representing all possible address types.

**Signature**

```ts
export declare const AddressEras: Schema.Union<
  [
    typeof BaseAddress.BaseAddress,
    typeof EnterpriseAddress.EnterpriseAddress,
    typeof PointerAddress.PointerAddress,
    typeof RewardAccount.RewardAccount,
    typeof ByronAddress.ByronAddress
  ]
>
```

Added in v2.0.0

## AddressEras (type alias)

Type representing an address.

**Signature**

```ts
export type AddressEras = typeof AddressEras.Type
```

Added in v2.0.0

## AddressError (class)

Error thrown when address operations fail

**Signature**

```ts
export declare class AddressError
```

Added in v2.0.0

# parsing

## fromBech32

Parse an Address from Bech32 string.

**Signature**

```ts
export declare const fromBech32: (
  input: string
) =>
  | RewardAccount.RewardAccount
  | BaseAddress.BaseAddress
  | EnterpriseAddress.EnterpriseAddress
  | PointerAddress.PointerAddress
  | ByronAddress.ByronAddress
```

Added in v2.0.0

## fromBytes

Parse an Address from bytes.

**Signature**

```ts
export declare const fromBytes: (
  input: any
) =>
  | RewardAccount.RewardAccount
  | BaseAddress.BaseAddress
  | EnterpriseAddress.EnterpriseAddress
  | PointerAddress.PointerAddress
  | ByronAddress.ByronAddress
```

Added in v2.0.0

## fromHex

Parse an Address from hex string.

**Signature**

```ts
export declare const fromHex: (
  input: string
) =>
  | RewardAccount.RewardAccount
  | BaseAddress.BaseAddress
  | EnterpriseAddress.EnterpriseAddress
  | PointerAddress.PointerAddress
  | ByronAddress.ByronAddress
```

Added in v2.0.0

# schema

## FromBech32

Schema for encoding/decoding addresses as Bech32 strings.

**Signature**

```ts
export declare const FromBech32: Schema.transformOrFail<
  typeof Schema.String,
  Schema.SchemaClass<
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress,
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress,
    never
  >,
  never
>
```

Added in v2.0.0

## FromBytes

Schema for encoding/decoding addresses as bytes.

**Signature**

```ts
export declare const FromBytes: Schema.transformOrFail<
  typeof Schema.Uint8ArrayFromSelf,
  Schema.SchemaClass<
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress,
    | RewardAccount.RewardAccount
    | BaseAddress.BaseAddress
    | EnterpriseAddress.EnterpriseAddress
    | PointerAddress.PointerAddress
    | ByronAddress.ByronAddress,
    never
  >,
  never
>
```

Added in v2.0.0

## FromHex

Schema for encoding/decoding addresses as hex strings.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.transform<Schema.Schema<string, string, never>, Schema.Schema<Uint8Array, Uint8Array, never>>,
  Schema.transformOrFail<
    typeof Schema.Uint8ArrayFromSelf,
    Schema.SchemaClass<
      | RewardAccount.RewardAccount
      | BaseAddress.BaseAddress
      | EnterpriseAddress.EnterpriseAddress
      | PointerAddress.PointerAddress
      | ByronAddress.ByronAddress,
      | RewardAccount.RewardAccount
      | BaseAddress.BaseAddress
      | EnterpriseAddress.EnterpriseAddress
      | PointerAddress.PointerAddress
      | ByronAddress.ByronAddress,
      never
    >,
    never
  >
>
```

Added in v2.0.0

# utils

## equals

Checks if two addresses are equal.

**Signature**

```ts
export declare const equals: (a: AddressEras, b: AddressEras) => boolean
```

Added in v2.0.0

## isAddress

**Signature**

```ts
export declare const isAddress: (
  u: unknown,
  overrideOptions?: ParseOptions | number
) => u is
  | RewardAccount.RewardAccount
  | BaseAddress.BaseAddress
  | EnterpriseAddress.EnterpriseAddress
  | PointerAddress.PointerAddress
  | ByronAddress.ByronAddress
```
