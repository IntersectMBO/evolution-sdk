---

title: TransactionHash.ts
nav_order: 177
parent: Modules
---

## TransactionHash overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [encoding](#encoding)
  - [toBytes](#tobytes)
  - [toHex](#tohex)
- [model](#model)
  - [Hex (type alias)](#hex-type-alias)
- [parsing](#parsing)
  - [fromBytes](#frombytes)
- [predicates](#predicates)
  - [isTransactionHash](#istransactionhash)
- [schemas](#schemas)
  - [FromBytes](#frombytes-1)
  - [Hex](#hex)
  - [TransactionHash (class)](#transactionhash-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
- [utils](#utils)
  - [FromHex](#fromhex)
  - [fromHex](#fromhex-1)

---

# arbitrary

## arbitrary

FastCheck arbitrary for generating random TransactionHash instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<TransactionHash>
```

Added in v2.0.0

# encoding

## toBytes

Encode TransactionHash to bytes.

**Signature**

```ts
export declare const toBytes: (a: TransactionHash, overrideOptions?: ParseOptions) => Uint8Array
```

Added in v2.0.0

## toHex

Encode TransactionHash to hex string.

**Signature**

```ts
export declare const toHex: (value: Parameters<typeof encodeHex>[0]) => Hex
```

Added in v2.0.0

# model

## Hex (type alias)

**Signature**

```ts
export type Hex = typeof Hex.Type
```

Added in v2.4.0

# parsing

## fromBytes

Parse TransactionHash from bytes.

**Signature**

```ts
export declare const fromBytes: (i: Uint8Array, overrideOptions?: ParseOptions) => TransactionHash
```

Added in v2.0.0

# predicates

## isTransactionHash

Check if the given value is a valid TransactionHash

**Signature**

```ts
export declare const isTransactionHash: (u: unknown, overrideOptions?: ParseOptions | number) => u is TransactionHash
```

Added in v2.0.0

# schemas

## FromBytes

Schema for transforming between Uint8Array and TransactionHash.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<TransactionHash, TransactionHash, never>
>
```

Added in v2.0.0

## Hex

A transaction hash as hex.

Validated as well as branded: a 32-byte lowercase or uppercase hex string. {@link toHex}
returns this type, so the kind of a hex string survives leaving the typed domain — upstream of
this, every hash and key was an unmarked `string` once encoded.

⚠️ Branded apart from every other 32-byte hash hex. They are the same shape, and the type
system is the only thing standing between a transaction hash and a datum hash.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "TransactionHashHex">
```

Added in v2.4.0

## TransactionHash (class)

Schema for TransactionHash.
transaction_hash = Bytes32

**Signature**

```ts
export declare class TransactionHash
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

# utils

## FromHex

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<
    Schema.SchemaClass<Uint8Array, Uint8Array, never>,
    Schema.SchemaClass<TransactionHash, TransactionHash, never>
  >
>
```

## fromHex

**Signature**

```ts
export declare const fromHex: (i: string, overrideOptions?: ParseOptions) => TransactionHash
```
