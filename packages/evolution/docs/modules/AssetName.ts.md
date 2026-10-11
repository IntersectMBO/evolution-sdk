---

title: AssetName.ts
nav_order: 5
parent: Modules
---

## AssetName overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [encoding](#encoding)
  - [toBytes](#tobytes)
- [model](#model)
  - [AssetName (class)](#assetname-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
  - [Hex (type alias)](#hex-type-alias)
- [parsing](#parsing)
  - [fromBytes](#frombytes)
  - [fromHex](#fromhex)
- [predicates](#predicates)
  - [isAssetName](#isassetname)
- [schemas](#schemas)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex-1)
  - [Hex](#hex)
- [utils](#utils)
  - [toHex](#tohex)

---

# arbitrary

## arbitrary

FastCheck arbitrary for generating random AssetName instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<AssetName>
```

Added in v2.0.0

# encoding

## toBytes

Encode AssetName to bytes.

**Signature**

```ts
export declare const toBytes: (assetName: AssetName) => Uint8Array
```

Added in v2.0.0

# model

## AssetName (class)

Schema for AssetName representing a native asset identifier.
Asset names are limited to 32 bytes (0-64 hex characters).

**Signature**

```ts
export declare class AssetName
```

Added in v2.0.0

### toJSON (method)

Convert to JSON representation.

**Signature**

```ts
toJSON()
```

Added in v2.0.0

### toString (method)

Convert to string representation.

**Signature**

```ts
toString(): string
```

Added in v2.0.0

### [Inspectable.NodeInspectSymbol] (method)

Custom inspect for Node.js REPL.

**Signature**

```ts
[Inspectable.NodeInspectSymbol](): unknown
```

Added in v2.0.0

### [Equal.symbol] (method)

Structural equality check.

**Signature**

```ts
[Equal.symbol](that: unknown): boolean
```

Added in v2.0.0

### [Hash.symbol] (method)

Content-based hash for optimization of Equal.equals.

**Signature**

```ts
[Hash.symbol](): number
```

Added in v2.0.0

## Hex (type alias)

**Signature**

```ts
export type Hex = typeof Hex.Type
```

Added in v2.4.0

# parsing

## fromBytes

Parse AssetName from bytes.

**Signature**

```ts
export declare const fromBytes: (bytes: Uint8Array) => AssetName
```

Added in v2.0.0

## fromHex

Parse AssetName from hex string.

**Signature**

```ts
export declare const fromHex: (hex: string) => AssetName
```

Added in v2.0.0

# predicates

## isAssetName

Check if the given value is a valid AssetName

**Signature**

```ts
export declare const isAssetName: (u: unknown, overrideOptions?: ParseOptions | number) => u is AssetName
```

Added in v2.0.0

# schemas

## FromBytes

Schema for encoding/decoding AssetName as bytes.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<AssetName, AssetName, never>
>
```

Added in v2.0.0

## FromHex

Schema for encoding/decoding AssetName as hex strings.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<Schema.SchemaClass<Uint8Array, Uint8Array, never>, Schema.SchemaClass<AssetName, AssetName, never>>
>
```

Added in v2.0.0

## Hex

An asset name as hex, 0 to 32 bytes.

⚠️ The EMPTY string is a valid asset name, not a missing one — a policy's unnamed asset is
spelled exactly that way — so the pattern admits it deliberately.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "AssetNameHex">
```

Added in v2.4.0

# utils

## toHex

**Signature**

```ts
export declare const toHex: (assetName: AssetName) => Hex
```
