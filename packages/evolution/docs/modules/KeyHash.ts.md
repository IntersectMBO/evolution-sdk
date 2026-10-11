---

title: KeyHash.ts
nav_order: 73
parent: Modules
---

## KeyHash overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [constructors](#constructors)
  - [fromPrivateKey](#fromprivatekey)
  - [fromVKey](#fromvkey)
- [encoding/decoding](#encodingdecoding)
  - [fromBech32](#frombech32)
  - [fromBytes](#frombytes)
  - [toBech32](#tobech32)
  - [toBytes](#tobytes)
- [model](#model)
  - [Hex (type alias)](#hex-type-alias)
  - [KeyHash (class)](#keyhash-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
- [schemas](#schemas)
  - [Hex](#hex)
- [transformer](#transformer)
  - [FromBech32](#frombech32-1)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex)
- [utils](#utils)
  - [fromHex](#fromhex-1)
  - [toHex](#tohex)

---

# arbitrary

## arbitrary

FastCheck arbitrary for generating random KeyHash instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<KeyHash>
```

Added in v2.0.0

# constructors

## fromPrivateKey

Create a KeyHash from a PrivateKey

**Signature**

```ts
export declare const fromPrivateKey: (privateKey: PrivateKey) => KeyHash
```

Added in v2.0.0

## fromVKey

Create a KeyHash from a VKey

**Signature**

```ts
export declare const fromVKey: (vkey: VKey.VKey) => KeyHash
```

Added in v2.0.0

# encoding/decoding

## fromBech32

Parse a KeyHash from a bech32 string (addr_vkh1...).

**Signature**

```ts
export declare const fromBech32: (i: string, overrideOptions?: ParseOptions) => KeyHash
```

Added in v2.0.0

## fromBytes

Decode a KeyHash from raw bytes.

**Signature**

```ts
export declare const fromBytes: (i: Uint8Array, overrideOptions?: ParseOptions) => KeyHash
```

Added in v2.0.0

## toBech32

Convert a KeyHash to a bech32 string (addr_vkh1...).

**Signature**

```ts
export declare const toBech32: (a: KeyHash, overrideOptions?: ParseOptions) => string
```

Added in v2.0.0

## toBytes

Convert a KeyHash to raw bytes.

**Signature**

```ts
export declare const toBytes: (a: KeyHash, overrideOptions?: ParseOptions) => Uint8Array
```

Added in v2.0.0

# model

## Hex (type alias)

**Signature**

```ts
export type Hex = typeof Hex.Type
```

Added in v2.4.0

## KeyHash (class)

KeyHash

CDDL:

```
addr_keyhash = hash28
```

**Signature**

```ts
export declare class KeyHash
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

# schemas

## Hex

An Ed25519 key hash as hex.

Validated as well as branded: a 28-byte hex string, either case. {@link toHex} returns
this type, so the kind survives leaving the typed domain.

⚠️ Same shape as a script hash and a policy id, all three 28 bytes. A credential of the wrong
kind travels a long way before anything notices.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "KeyHashHex">
```

Added in v2.4.0

# transformer

## FromBech32

Schema transformer from bech32 string (addr_vkh1...) to KeyHash.
Uses the CIP-0005 `addr_vkh` prefix for address verification key hashes.

**Signature**

```ts
export declare const FromBech32: Schema.transformOrFail<
  typeof Schema.String,
  Schema.SchemaClass<KeyHash, KeyHash, never>,
  never
>
```

Added in v2.0.0

## FromBytes

Schema transformer from bytes to KeyHash.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<KeyHash, KeyHash, never>
>
```

Added in v2.0.0

## FromHex

Schema transformer from hex string to KeyHash.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<Schema.SchemaClass<Uint8Array, Uint8Array, never>, Schema.SchemaClass<KeyHash, KeyHash, never>>
>
```

Added in v2.0.0

# utils

## fromHex

**Signature**

```ts
export declare const fromHex: (i: string, overrideOptions?: ParseOptions) => KeyHash
```

## toHex

**Signature**

```ts
export declare const toHex: (value: Parameters<typeof encodeHex>[0]) => Hex
```
