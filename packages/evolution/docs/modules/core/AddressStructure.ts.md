---
title: core/AddressStructure.ts
nav_order: 3
parent: Modules
---

## AddressStructure overview

Added in v1.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [Arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [Functions](#functions)
  - [fromBech32](#frombech32)
- [Schema](#schema)
  - [AddressStructure (class)](#addressstructure-class)
    - [toString (method)](#tostring-method)
    - [[Symbol.for("nodejs.util.inspect.custom")] (method)](#symbolfornodejsutilinspectcustom-method)
- [Transformations](#transformations)
  - [FromBech32](#frombech32-1)
  - [FromBytes](#frombytes)
  - [FromHex](#fromhex)
- [Utils](#utils)
  - [equals](#equals)
  - [getNetworkId](#getnetworkid)
  - [hasStakingCredential](#hasstakingcredential)
  - [isEnterprise](#isenterprise)
- [utils](#utils-1)
  - [AddressStructureError (class)](#addressstructureerror-class)
  - [Either (namespace)](#either-namespace)
  - [fromBytes](#frombytes-1)
  - [fromHex](#fromhex-1)
  - [toBech32](#tobech32)
  - [toBytes](#tobytes)
  - [toHex](#tohex)

---

# Arbitrary

## arbitrary

FastCheck arbitrary generator for testing

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<AddressStructure>
```

Added in v1.0.0

# Functions

## fromBech32

Sync functions using Function module utilities

**Signature**

```ts
export declare const fromBech32: (input: string) => AddressStructure
```

Added in v1.0.0

# Schema

## AddressStructure (class)

**Signature**

```ts
export declare class AddressStructure
```

Added in v1.0.0

### toString (method)

**Signature**

```ts
toString(): string
```

### [Symbol.for("nodejs.util.inspect.custom")] (method)

**Signature**

```ts
[Symbol.for("nodejs.util.inspect.custom")](): string
```

# Transformations

## FromBech32

Transform from Bech32 string to AddressStructure

**Signature**

```ts
export declare const FromBech32: Schema.transformOrFail<
  typeof Schema.String,
  Schema.SchemaClass<AddressStructure, AddressStructure, never>,
  never
>
```

Added in v1.0.0

## FromBytes

Transform from bytes to AddressStructure
Handles both BaseAddress (57 bytes) and EnterpriseAddress (29 bytes)

**Signature**

```ts
export declare const FromBytes: Schema.transformOrFail<
  Schema.Union<[Schema.filter<typeof Schema.Uint8ArrayFromSelf>, Schema.filter<typeof Schema.Uint8ArrayFromSelf>]>,
  Schema.SchemaClass<AddressStructure, AddressStructure, never>,
  never
>
```

Added in v1.0.0

## FromHex

Transform from hex string to AddressStructure

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.transform<Schema.Schema<string, string, never>, Schema.Schema<Uint8Array, Uint8Array, never>>,
  Schema.transformOrFail<
    Schema.Union<[Schema.filter<typeof Schema.Uint8ArrayFromSelf>, Schema.filter<typeof Schema.Uint8ArrayFromSelf>]>,
    Schema.SchemaClass<AddressStructure, AddressStructure, never>,
    never
  >
>
```

Added in v1.0.0

# Utils

## equals

Check if two AddressStructure instances are equal.

**Signature**

```ts
export declare const equals: (a: AddressStructure, b: AddressStructure) => boolean
```

Added in v1.0.0

## getNetworkId

Get network ID from AddressStructure

**Signature**

```ts
export declare const getNetworkId: (address: AddressStructure) => NetworkId.NetworkId
```

Added in v1.0.0

## hasStakingCredential

Check if AddressStructure has staking credential (BaseAddress-like)

**Signature**

```ts
export declare const hasStakingCredential: (address: AddressStructure) => boolean
```

Added in v1.0.0

## isEnterprise

Check if AddressStructure is enterprise-like (no staking credential)

**Signature**

```ts
export declare const isEnterprise: (address: AddressStructure) => boolean
```

Added in v1.0.0

# utils

## AddressStructureError (class)

**Signature**

```ts
export declare class AddressStructureError
```

## Either (namespace)

## fromBytes

**Signature**

```ts
export declare const fromBytes: (input: any) => AddressStructure
```

## fromHex

**Signature**

```ts
export declare const fromHex: (input: string) => AddressStructure
```

## toBech32

**Signature**

```ts
export declare const toBech32: (input: AddressStructure) => string
```

## toBytes

**Signature**

```ts
export declare const toBytes: (input: AddressStructure) => any
```

## toHex

**Signature**

```ts
export declare const toHex: (input: AddressStructure) => string
```
