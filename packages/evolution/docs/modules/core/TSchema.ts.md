---
title: core/TSchema.ts
nav_order: 115
parent: Modules
---

## TSchema overview

---

<h2 class="text-delta">Table of contents</h2>

- [schemas](#schemas)
  - [ByteArray](#bytearray)
  - [HexString](#hexstring)
  - [Integer](#integer)
- [utils](#utils)
  - [Array](#array)
  - [Boolean](#boolean)
  - [ByteArray (interface)](#bytearray-interface)
  - [Integer (interface)](#integer-interface)
  - [Literal](#literal)
  - [Map](#map)
  - [NullOr](#nullor)
  - [OneLiteral](#oneliteral)
  - [Struct](#struct)
  - [Tuple](#tuple)
  - [UndefinedOr](#undefinedor)
  - [Union](#union)
  - [compose](#compose)
  - [filter](#filter)
  - [is](#is)

---

# schemas

## ByteArray

ByteArray schema that transforms hex string to Data.ByteArray for PlutusData.
This enables withSchema compatibility by transforming from hex string to Uint8Array.

**Signature**

```ts
export declare const ByteArray: ByteArray
```

Added in v2.0.0

## HexString

HexString schema that transforms hex string to ByteArray for PlutusData.
This transforms from hex string to Uint8Array (runtime Data type) and back.

**Signature**

```ts
export declare const HexString: Schema.transform<typeof Schema.Uint8ArrayFromSelf, typeof Schema.String>
```

Added in v2.0.0

## Integer

Integer schema that represents Data.Int for PlutusData.
This enables withSchema compatibility by using the Data type schema directly.

**Signature**

```ts
export declare const Integer: Integer
```

Added in v2.0.0

# utils

## Array

Creates a schema for arrays - just passes through to Schema.Array directly

**Signature**

```ts
export declare const Array: <S extends Schema.Schema.Any>(items: S) => Array<S>
```

Added in v1.0.0

## Boolean

Schema for boolean values using Plutus Data Constructor

- False with index 0
- True with index 1

**Signature**

```ts
export declare const Boolean: Boolean
```

Added in v2.0.0

## ByteArray (interface)

**Signature**

```ts
export interface ByteArray
  extends Schema.transform<
    Schema.SchemaClass<Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>, never>,
    typeof Schema.String
  > {}
```

## Integer (interface)

**Signature**

```ts
export interface Integer extends Schema.SchemaClass<bigint, bigint, never> {}
```

## Literal

Creates a schema for literal types with Plutus Data Constructor transformation

**Signature**

```ts
export declare const Literal: <Literals extends NonEmptyReadonlyArray<Exclude<SchemaAST.LiteralValue, null | bigint>>>(
  ...self: Literals
) => Literal<Literals>
```

Added in v2.0.0

## Map

Creates a schema for maps with Plutus Map type annotation
Maps are represented as a list of constructor pairs, where each pair
is a constructor with index 0 and fields [key, value]

**Signature**

```ts
export declare const Map: <K extends Schema.Schema.Any, V extends Schema.Schema.Any>(key: K, value: V) => Map<K, V>
```

Added in v1.0.0

## NullOr

Creates a schema for nullable types that transforms to/from Plutus Data Constructor
Represents optional values as:

- Just(value) with index 0
- Nothing with index 1

**Signature**

```ts
export declare const NullOr: <S extends Schema.Schema.All>(self: S) => NullOr<S>
```

Added in v2.0.0

## OneLiteral

**Signature**

```ts
export declare const OneLiteral: <Single extends Exclude<SchemaAST.LiteralValue, null | bigint>>(
  self: Single
) => OneLiteral<Single>
```

## Struct

Creates a schema for struct types using Plutus Data Constructor
Objects are represented as a constructor with index 0 and fields as an array

**Signature**

```ts
export declare const Struct: <Fields extends Schema.Struct.Fields>(fields: Fields) => Struct<Fields>
```

Added in v2.0.0

## Tuple

Creates a schema for tuple types - just passes through to Schema.Tuple directly

**Signature**

```ts
export declare const Tuple: <Elements extends Schema.TupleType.Elements>(element: [...Elements]) => Tuple<Elements>
```

Added in v2.0.0

## UndefinedOr

Creates a schema for undefined types that transforms to/from Plutus Data Constructor
Represents optional values as:

- Just(value) with index 0
- Nothing with index 1

**Signature**

```ts
export declare const UndefinedOr: <S extends Schema.Schema.Any>(self: S) => UndefineOr<S>
```

Added in v2.0.0

## Union

Creates a schema for union types using Plutus Data Constructor
Unions are represented as a constructor with index 0 and fields as an array

**Signature**

```ts
export declare const Union: <Members extends ReadonlyArray<Schema.Schema.Any>>(...members: Members) => Union<Members>
```

Added in v2.0.0

## compose

**Signature**

```ts
export declare const compose: {
  <To extends Schema.Schema.Any, From extends Schema.Schema.Any, C extends Schema.Schema.Type<From>>(
    to: To & Schema.Schema<Schema.Schema.Type<To>, C, Schema.Schema.Context<To>>
  ): (from: From) => Schema.transform<From, To>
  <To extends Schema.Schema.Any>(
    to: To
  ): <From extends Schema.Schema.Any, B extends Schema.Schema.Encoded<To>>(
    from: From & Schema.Schema<B, Schema.Schema.Encoded<From>, Schema.Schema.Context<From>>
  ) => Schema.transform<From, To>
  <To extends Schema.Schema.Any>(
    to: To,
    options?: { readonly strict: true }
  ): <From extends Schema.Schema.Any>(
    from: From & Schema.Schema<Schema.Schema.Encoded<To>, Schema.Schema.Encoded<From>, Schema.Schema.Context<From>>
  ) => Schema.transform<From, To>
  <To extends Schema.Schema.Any>(
    to: To,
    options: { readonly strict: false }
  ): <From extends Schema.Schema.Any>(from: From) => Schema.transform<From, To>
  <From extends Schema.Schema.Any, To extends Schema.Schema.Any, C extends Schema.Schema.Type<From>>(
    from: From,
    to: To & Schema.Schema<Schema.Schema.Type<To>, C, Schema.Schema.Context<To>>
  ): Schema.transform<From, To>
  <From extends Schema.Schema.Any, B extends Schema.Schema.Encoded<To>, To extends Schema.Schema.Any>(
    from: From & Schema.Schema<B, Schema.Schema.Encoded<From>, Schema.Schema.Context<From>>,
    to: To
  ): Schema.transform<From, To>
  <From extends Schema.Schema.Any, To extends Schema.Schema.Any>(
    from: From & Schema.Schema<Schema.Schema.Encoded<To>, Schema.Schema.Encoded<From>, Schema.Schema.Context<From>>,
    to: To,
    options?: { readonly strict: true }
  ): Schema.transform<From, To>
  <From extends Schema.Schema.Any, To extends Schema.Schema.Any>(
    from: From,
    to: To,
    options: { readonly strict: false }
  ): Schema.transform<From, To>
}
```

## filter

**Signature**

```ts
export declare const filter: typeof Schema.filter
```

## is

**Signature**

```ts
export declare const is: <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  options?: SchemaAST.ParseOptions
) => (u: unknown, overrideOptions?: SchemaAST.ParseOptions | number) => u is A
```
