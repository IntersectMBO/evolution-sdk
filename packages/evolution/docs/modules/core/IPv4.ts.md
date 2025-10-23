---
title: core/IPv4.ts
nav_order: 56
parent: Modules
---

## IPv4 overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [either](#either)
  - [Either (namespace)](#either-namespace)
- [encoding](#encoding)
  - [toBytes](#tobytes)
  - [toHex](#tohex)
- [equality](#equality)
  - [equals](#equals)
- [errors](#errors)
  - [IPv4Error (class)](#ipv4error-class)
- [parsing](#parsing)
  - [fromBytes](#frombytes)
  - [fromHex](#fromhex)
- [predicates](#predicates)
  - [isIPv4](#isipv4)
- [schemas](#schemas)
  - [IPv4 (class)](#ipv4-class)
- [utils](#utils)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex-1)

---

# arbitrary

## arbitrary

FastCheck arbitrary for generating random IPv4 instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<IPv4>
```

Added in v2.0.0

# either

## Either (namespace)

Either-based error handling variants for functions that can fail.

Added in v2.0.0

# encoding

## toBytes

Encode IPv4 to bytes.

**Signature**

```ts
export declare const toBytes: (input: IPv4) => Uint8Array
```

Added in v2.0.0

## toHex

Encode IPv4 to hex string.

**Signature**

```ts
export declare const toHex: (input: IPv4) => string
```

Added in v2.0.0

# equality

## equals

Equality on bytes

**Signature**

```ts
export declare const equals: (a: IPv4, b: IPv4) => boolean
```

Added in v2.0.0

# errors

## IPv4Error (class)

Error class for IPv4 related operations.

**Signature**

```ts
export declare class IPv4Error
```

Added in v2.0.0

# parsing

## fromBytes

Parse IPv4 from bytes.

**Signature**

```ts
export declare const fromBytes: (input: Uint8Array) => IPv4
```

Added in v2.0.0

## fromHex

Parse IPv4 from hex string.

**Signature**

```ts
export declare const fromHex: (input: string) => IPv4
```

Added in v2.0.0

# predicates

## isIPv4

Predicate for IPv4 instances

**Signature**

```ts
export declare const isIPv4: (u: unknown, overrideOptions?: ParseOptions | number) => u is IPv4
```

Added in v2.0.0

# schemas

## IPv4 (class)

IPv4 model stored as 4 raw bytes (network byte order).

**Signature**

```ts
export declare class IPv4
```

Added in v2.0.0

# utils

## FromBytes

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<IPv4, IPv4, never>
>
```

## FromHex

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<Schema.SchemaClass<Uint8Array, Uint8Array, never>, Schema.SchemaClass<IPv4, IPv4, never>>
>
```
