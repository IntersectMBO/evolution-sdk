---

title: Ed25519Signature.ts
nav_order: 58
parent: Modules
---

## Ed25519Signature overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [constructors](#constructors)
  - [fromBytes](#frombytes)
- [encoding](#encoding)
  - [toBytes](#tobytes)
- [model](#model)
  - [Ed25519Signature (class)](#ed25519signature-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
  - [Hex (type alias)](#hex-type-alias)
- [predicates](#predicates)
  - [is](#is)
- [schemas](#schemas)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex)
  - [Hex](#hex)
- [utils](#utils)
  - [fromHex](#fromhex-1)
  - [toHex](#tohex)

---

# arbitrary

## arbitrary

FastCheck arbitrary for generating random Ed25519Signature instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<Ed25519Signature>
```

Added in v2.0.0

# constructors

## fromBytes

Parse Ed25519Signature from bytes (unsafe - throws on error).

**Signature**

```ts
export declare const fromBytes: (i: Uint8Array, overrideOptions?: ParseOptions) => Ed25519Signature
```

Added in v2.0.0

# encoding

## toBytes

Get the underlying bytes (returns a copy for safety).

**Signature**

```ts
export declare const toBytes: (a: Ed25519Signature, overrideOptions?: ParseOptions) => Uint8Array
```

Added in v2.0.0

# model

## Ed25519Signature (class)

Class-based Ed25519Signature with compile-time and runtime safety.
ed25519_signature = bytes .size 64
Follows the Conway-era CDDL specification.

**Signature**

```ts
export declare class Ed25519Signature
```

Added in v2.0.0

### toJSON (method)

**Signature**

```ts
toJSON()
```

### toString (method)

**Signature**

```ts
toString(): string
```

### [Inspectable.NodeInspectSymbol] (method)

**Signature**

```ts
[Inspectable.NodeInspectSymbol](): unknown
```

### [Equal.symbol] (method)

**Signature**

```ts
[Equal.symbol](that: unknown): boolean
```

### [Hash.symbol] (method)

**Signature**

```ts
[Hash.symbol](): number
```

## Hex (type alias)

**Signature**

```ts
export type Hex = typeof Hex.Type
```

Added in v2.4.0

# predicates

## is

Check if value is an Ed25519Signature instance.

**Signature**

```ts
export declare const is: (u: unknown, overrideOptions?: ParseOptions | number) => u is Ed25519Signature
```

Added in v2.0.0

# schemas

## FromBytes

Schema transformer from bytes to Ed25519Signature.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<Ed25519Signature, Ed25519Signature, never>
>
```

Added in v2.0.0

## FromHex

Schema transformer from hex string to Ed25519Signature.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<
    Schema.SchemaClass<Uint8Array, Uint8Array, never>,
    Schema.SchemaClass<Ed25519Signature, Ed25519Signature, never>
  >
>
```

Added in v2.0.0

## Hex

An Ed25519 signature as hex (64 bytes).

Validated as well as branded: a 64-byte hex string, either case. {@link toHex} returns
this type, so the kind survives leaving the typed domain.

⚠️ Branded apart from a verification key because a `vkeywitness` holds exactly those two, in
that order, and transposing them yields a witness that is structurally valid and verifies
against nothing.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "Ed25519SignatureHex">
```

Added in v2.4.0

# utils

## fromHex

**Signature**

```ts
export declare const fromHex: (i: string, overrideOptions?: ParseOptions) => Ed25519Signature
```

## toHex

**Signature**

```ts
export declare const toHex: (value: Parameters<typeof encodeHex>[0]) => Hex
```
