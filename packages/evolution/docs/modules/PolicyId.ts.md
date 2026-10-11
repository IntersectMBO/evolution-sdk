---

title: PolicyId.ts
nav_order: 102
parent: Modules
---

## PolicyId overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [encoding](#encoding)
  - [toBytes](#tobytes)
- [model](#model)
  - [Hex (type alias)](#hex-type-alias)
  - [PolicyId (class)](#policyid-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
- [parsing](#parsing)
  - [fromBytes](#frombytes)
- [predicates](#predicates)
  - [isPolicyId](#ispolicyid)
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

FastCheck arbitrary for generating random PolicyId instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<PolicyId>
```

Added in v2.0.0

# encoding

## toBytes

Encode PolicyId to bytes.

**Signature**

```ts
export declare const toBytes: (a: PolicyId, overrideOptions?: ParseOptions) => Uint8Array
```

Added in v2.0.0

# model

## Hex (type alias)

**Signature**

```ts
export type Hex = typeof Hex.Type
```

Added in v2.4.0

## PolicyId (class)

PolicyId as a TaggedClass representing a minting policy identifier.
A PolicyId is a script hash (hash28) that identifies a minting policy.

Note: PolicyId is equivalent to ScriptHash as defined in the CDDL:
policy_id = script_hash
script_hash = hash28

**Signature**

```ts
export declare class PolicyId
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

# parsing

## fromBytes

Parse PolicyId from bytes.

**Signature**

```ts
export declare const fromBytes: (i: Uint8Array, overrideOptions?: ParseOptions) => PolicyId
```

Added in v2.0.0

# predicates

## isPolicyId

Check if the given value is a valid PolicyId

**Signature**

```ts
export declare const isPolicyId: (u: unknown, overrideOptions?: ParseOptions | number) => u is PolicyId
```

Added in v2.0.0

# schemas

## FromBytes

Schema transformer from bytes to PolicyId.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<PolicyId, PolicyId, never>
>
```

Added in v2.0.0

## FromHex

Schema transformer from hex string to PolicyId.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<Schema.SchemaClass<Uint8Array, Uint8Array, never>, Schema.SchemaClass<PolicyId, PolicyId, never>>
>
```

Added in v2.0.0

## Hex

A minting policy id as hex.

Validated as well as branded: a 28-byte hex string, either case. {@link toHex} returns
this type, so the kind survives leaving the typed domain.

⚠️ A policy id IS a script hash, and 28 bytes like a key hash. The brand is what keeps a
credential out of a policy position.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "PolicyIdHex">
```

Added in v2.4.0

# utils

## fromHex

**Signature**

```ts
export declare const fromHex: (i: string, overrideOptions?: ParseOptions) => PolicyId
```

## toHex

**Signature**

```ts
export declare const toHex: (value: Parameters<typeof encodeHex>[0]) => Hex
```
