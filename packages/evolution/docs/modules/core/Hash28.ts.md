---
title: core/Hash28.ts
nav_order: 53
parent: Modules
---

## Hash28 overview

Hash28 module provides utilities for handling 28-byte hash values and variable-length byte arrays.

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [constants](#constants)
  - [BYTES_LENGTH](#bytes_length)
- [decoding](#decoding)
  - [fromHex](#fromhex)
  - [fromVariableHex](#fromvariablehex)
- [encoding](#encoding)
  - [toHex](#tohex)
  - [toVariableHex](#tovariablehex)
- [errors](#errors)
  - [Hash28Error (class)](#hash28error-class)
- [utils](#utils)
  - [BytesFromHex](#bytesfromhex)
  - [Either (namespace)](#either-namespace)
  - [VariableBytesFromHex](#variablebytesfromhex)
  - [equals](#equals)

---

# constants

## BYTES_LENGTH

Constant bytes length

**Signature**

```ts
export declare const BYTES_LENGTH: 28
```

Added in v2.0.0

# decoding

## fromHex

Decode fixed-length hex into bytes.

**Signature**

```ts
export declare const fromHex: (input: string) => Uint8Array
```

Added in v2.0.0

## fromVariableHex

Decode variable-length hex (0..BYTES_LENGTH) into bytes.

**Signature**

```ts
export declare const fromVariableHex: (input: string) => Uint8Array
```

Added in v2.0.0

# encoding

## toHex

Encode fixed-length bytes to hex.

**Signature**

```ts
export declare const toHex: (input: Uint8Array) => string
```

Added in v2.0.0

## toVariableHex

Encode variable-length bytes (0..BYTES_LENGTH) to hex.

**Signature**

```ts
export declare const toVariableHex: (input: Uint8Array) => string
```

Added in v2.0.0

# errors

## Hash28Error (class)

Error type for this module.

**Signature**

```ts
export declare class Hash28Error
```

Added in v2.0.0

# utils

## BytesFromHex

**Signature**

```ts
export declare const BytesFromHex: Schema.filter<Schema.Schema<Uint8Array, string, never>>
```

## Either (namespace)

## VariableBytesFromHex

**Signature**

```ts
export declare const VariableBytesFromHex: Schema.filter<Schema.Schema<Uint8Array, string, never>>
```

## equals

**Signature**

```ts
export declare const equals: (a: Uint8Array, b: Uint8Array) => boolean
```
