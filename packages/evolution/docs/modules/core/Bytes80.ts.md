---
title: core/Bytes80.ts
nav_order: 29
parent: Modules
---

## Bytes80 overview

Bytes80 module provides utilities for handling fixed-length and variable-length byte arrays.

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
  - [Bytes80Error (class)](#bytes80error-class)
- [schemas](#schemas)
  - [FromHex](#fromhex-1)
  - [VariableBytesFromHex](#variablebytesfromhex)
- [utils](#utils)
  - [BytesSchema](#bytesschema)
  - [Either (namespace)](#either-namespace)
  - [HexSchema](#hexschema)
  - [equals](#equals)

---

# constants

## BYTES_LENGTH

Constant bytes length

**Signature**

```ts
export declare const BYTES_LENGTH: 80
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

## Bytes80Error (class)

Error type for this module.

**Signature**

```ts
export declare class Bytes80Error
```

Added in v2.0.0

# schemas

## FromHex

Schema transformation for fixed-length bytes

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.Schema<string, string, never>,
  Schema.Schema<Uint8Array, Uint8Array, never>
>
```

Added in v2.0.0

## VariableBytesFromHex

Schema transformation for variable-length bytes (0..BYTES_LENGTH).

**Signature**

```ts
export declare const VariableBytesFromHex: Schema.transform<
  Schema.Schema<string, string, never>,
  Schema.Schema<Uint8Array, Uint8Array, never>
>
```

Added in v2.0.0

# utils

## BytesSchema

**Signature**

```ts
export declare const BytesSchema: Schema.filter<typeof Schema.Uint8ArrayFromSelf>
```

## Either (namespace)

## HexSchema

**Signature**

```ts
export declare const HexSchema: Schema.filter<Schema.refine<string, typeof Schema.String>>
```

## equals

**Signature**

```ts
export declare const equals: (a: Uint8Array, b: Uint8Array) => boolean
```
