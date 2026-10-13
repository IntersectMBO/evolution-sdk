---

title: NonnegativeInterval.ts
nav_order: 86
parent: Modules
---

## NonnegativeInterval overview

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [fromDecimal](#fromdecimal)
- [model](#model)
  - [NonnegativeInterval (class)](#nonnegativeinterval-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
- [utils](#utils)
  - [CDDLSchema](#cddlschema)
  - [FromCBORBytes](#fromcborbytes)
  - [FromCBORHex](#fromcborhex)
  - [FromCDDL](#fromcddl)
  - [arbitrary](#arbitrary)
  - [ceilDiv](#ceildiv)

---

# constructors

## fromDecimal

An exact rational from a decimal, with no floating-point step in between.

Protocol parameters that are rationals in the ledger arrive as decimals over JSON:
`priceMem` is `0.0577`, `treasuryCut` is `0.2`. ⚠️ **None of those is representable in
binary floating point**, so arithmetic that goes through a `number` is arithmetic on a
value the chain never specified — and a fee rounded from it can land below the minimum
the node computed from the exact rational, which is a rejected transaction rather than a
rounding curiosity.

A `number` is read through its shortest round-tripping decimal (`String(0.0577)` is
`"0.0577"`), which recovers the decimal that was written rather than the binary value it
became: `0.0577` yields `577/10000`, not the dyadic expansion of the nearest double. Pass
a string when the source is text, which skips the double entirely.

**Signature**

```ts
export declare const fromDecimal: (value: number | string) => NonnegativeInterval
```

**Example**

```typescript
import * as NonnegativeInterval from "@evolution-sdk/evolution/NonnegativeInterval"

NonnegativeInterval.fromDecimal(0.0577) // 577/10000
NonnegativeInterval.fromDecimal("1.2") // 6/5
NonnegativeInterval.fromDecimal(15) // 15/1
```

Added in v2.5.0

# model

## NonnegativeInterval (class)

Schema for NonnegativeInterval representing a fractional value >= 0.

CDDL: nonnegative_interval = #6.30([uint, positive_int])

**Signature**

```ts
export declare class NonnegativeInterval
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

Hash code generation.

**Signature**

```ts
[Hash.symbol](): number
```

Added in v2.0.0

# utils

## CDDLSchema

**Signature**

```ts
export declare const CDDLSchema: Schema.TaggedStruct<
  "Tag",
  { tag: Schema.Literal<[30]>; value: Schema.Tuple2<typeof Schema.BigIntFromSelf, typeof Schema.BigIntFromSelf> }
>
```

## FromCBORBytes

**Signature**

```ts
export declare const FromCBORBytes: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.transformOrFail<
    typeof Schema.Uint8ArrayFromSelf,
    Schema.declare<CBOR.CBOR, CBOR.CBOR, readonly [], never>,
    never
  >,
  Schema.transformOrFail<
    Schema.TaggedStruct<
      "Tag",
      { tag: Schema.Literal<[30]>; value: Schema.Tuple2<typeof Schema.BigIntFromSelf, typeof Schema.BigIntFromSelf> }
    >,
    Schema.SchemaClass<NonnegativeInterval, NonnegativeInterval, never>,
    never
  >
>
```

## FromCBORHex

**Signature**

```ts
export declare const FromCBORHex: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.Schema<Uint8Array, string, never>,
  Schema.transform<
    Schema.transformOrFail<
      typeof Schema.Uint8ArrayFromSelf,
      Schema.declare<CBOR.CBOR, CBOR.CBOR, readonly [], never>,
      never
    >,
    Schema.transformOrFail<
      Schema.TaggedStruct<
        "Tag",
        { tag: Schema.Literal<[30]>; value: Schema.Tuple2<typeof Schema.BigIntFromSelf, typeof Schema.BigIntFromSelf> }
      >,
      Schema.SchemaClass<NonnegativeInterval, NonnegativeInterval, never>,
      never
    >
  >
>
```

## FromCDDL

Transform between tag(30) tuple and NonnegativeInterval model.

**Signature**

```ts
export declare const FromCDDL: Schema.transformOrFail<
  Schema.TaggedStruct<
    "Tag",
    { tag: Schema.Literal<[30]>; value: Schema.Tuple2<typeof Schema.BigIntFromSelf, typeof Schema.BigIntFromSelf> }
  >,
  Schema.SchemaClass<NonnegativeInterval, NonnegativeInterval, never>,
  never
>
```

## arbitrary

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<NonnegativeInterval>
```

## ceilDiv

Ceiling division for non-negative bigints — `⌈num / den⌉` with no float in the middle.

**Signature**

```ts
export declare const ceilDiv: (numerator: bigint, denominator: bigint) => bigint
```

Added in v2.5.0
