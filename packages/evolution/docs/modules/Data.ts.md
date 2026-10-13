---

title: Data.ts
nav_order: 51
parent: Modules
---

## Data overview

---

<h2 class="text-delta">Table of contents</h2>

- [combinators](#combinators)
  - [withSchema](#withschema)
- [constants](#constants)
  - [DEFAULT_CBOR_OPTIONS](#default_cbor_options)
- [constructors](#constructors)
  - [bytearray](#bytearray)
  - [constr](#constr)
  - [int](#int)
  - [list](#list)
  - [map](#map)
- [encoding](#encoding)
  - [spliceConstr](#spliceconstr)
  - [spliceList](#splicelist)
  - [spliceMap](#splicemap)
- [equality](#equality)
  - [equals](#equals)
  - [hash](#hash)
- [errors](#errors)
  - [DataError (class)](#dataerror-class)
- [generators](#generators)
  - [arbitrary](#arbitrary)
  - [arbitraryConstr](#arbitraryconstr)
  - [arbitraryPlutusBigInt](#arbitraryplutusbigint)
  - [arbitraryPlutusBytes](#arbitraryplutusbytes)
  - [arbitraryPlutusData](#arbitraryplutusdata)
  - [arbitraryPlutusList](#arbitraryplutuslist)
  - [arbitraryPlutusMap](#arbitraryplutusmap)
- [hashing](#hashing)
  - [~~hashData~~](#hashdata)
  - [toDatumHash](#todatumhash)
- [model](#model)
  - [Data (type alias)](#data-type-alias)
  - [DataEncoded (type alias)](#dataencoded-type-alias)
  - [Hex (type alias)](#hex-type-alias)
  - [List (type alias)](#list-type-alias)
  - [Map (type alias)](#map-type-alias)
- [predicates](#predicates)
  - [isBytes](#isbytes)
  - [isConstr](#isconstr)
  - [isData](#isdata)
  - [isInt](#isint)
  - [isList](#islist)
  - [isMap](#ismap)
- [schemas](#schemas)
  - [ByteArray](#bytearray-1)
  - [Constr (class)](#constr-class)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
  - [DataSchema](#dataschema)
  - [DataValue](#datavalue)
  - [FromCBORBytes](#fromcborbytes)
  - [FromCBORHex](#fromcborhex)
  - [FromCDDL](#fromcddl)
  - [Hex](#hex)
  - [IntSchema](#intschema)
  - [ListSchema](#listschema)
  - [MapSchema](#mapschema)
- [transformation](#transformation)
  - [cborValueToPlutusData](#cborvaluetoplutusdata)
  - [fromCBORBytes](#fromcborbytes-1)
  - [fromCBORHex](#fromcborhex-1)
  - [plutusDataToCBORValue](#plutusdatatocborvalue)
  - [toCBORBytes](#tocborbytes)
  - [toCBORHex](#tocborhex)
- [utilities](#utilities)
  - [matchConstr](#matchconstr)
  - [matchData](#matchdata)
- [utils](#utils)
  - [ByteArray (type alias)](#bytearray-type-alias)
  - [CDDLSchema](#cddlschema)
  - [DataSchema (interface)](#dataschema-interface)
  - [Int (type alias)](#int-type-alias)

---

# combinators

## withSchema

Create a schema that transforms from a custom type to Data and provides CBOR encoding

**Signature**

```ts
export declare const withSchema: <A, I extends Data>(
  schema: Schema.Schema<A, I>,
  options?: CBOR.CodecOptions
) => {
  toData: (a: A, overrideOptions?: ParseOptions) => I
  fromData: (i: I, overrideOptions?: ParseOptions) => A
  toCBORHex: (a: A, overrideOptions?: ParseOptions) => string
  toCBORBytes: (a: A, overrideOptions?: ParseOptions) => any
  fromCBORHex: (i: string, overrideOptions?: ParseOptions) => A
  fromCBORBytes: (i: any, overrideOptions?: ParseOptions) => A
}
```

Added in v2.0.0

# constants

## DEFAULT_CBOR_OPTIONS

Default CBOR options for Data encoding/decoding: {@link CBOR.PLUTUS_DATA_OPTIONS},
the layout the node writes.

**Signature**

```ts
export declare const DEFAULT_CBOR_OPTIONS: CBOR.CodecOptions
```

Added in v2.0.0

# constructors

## bytearray

Creates Plutus bounded bytes from hex string

**Signature**

```ts
export declare const bytearray: (bytes: string) => ByteArray
```

Added in v2.0.0

## constr

Creates a constructor with the specified index and data

**Signature**

```ts
export declare const constr: (index: bigint, fields: Array<Data>) => Constr
```

Added in v2.0.0

## int

Creates Plutus big integer

**Signature**

```ts
export declare const int: (integer: bigint) => Int
```

Added in v2.0.0

## list

Creates a Plutus list from items

**Signature**

```ts
export declare const list: (list: Array<Data>) => List
```

Added in v2.0.0

## map

Creates a Plutus map from key-value pairs

**Signature**

```ts
export declare const map: (entries: Array<[key: Data, value: Data]>) => Map
```

Added in v2.0.0

# encoding

## spliceConstr

A `Constr` over already-encoded fields, in the three tag ranges the Plutus encoding defines.

⚠️ The tag-102 wrapper `[index, fields]` is DEFINITE while the fields array inside it stays
indefinite. `cardano-serialization-lib` 15.0.3 and `cardano-multiplatform-lib` 6.2 both write
`d866 82 …`; no single codec option can say both, which is why the shape is written here.

See {@link spliceList} for when to reach for this rather than {@link constr}.

**Signature**

```ts
export declare const spliceConstr: (index: bigint, fieldItems: ReadonlyArray<Uint8Array>) => Uint8Array
```

Added in v2.8.0

## spliceList

Assemble `plutus_data` from children that are ALREADY encoded, splicing their bytes.

⚠️ **Why this exists next to the typed constructors.** {@link fromCBORBytes} records the bytes
every node arrived as and {@link toCBORBytes} replays them, so decoding a child and rebuilding
around it is lossless for anything that can carry a record. One thing cannot: a `bigint` is not
an object, so a non-minimally encoded integer (`19002a` for 42, which the ledger accepts and
nothing here writes) has nowhere to keep its header width. A caller holding encoded children
therefore has a choice between decoding them -- correct except for that integer -- and splicing
them, which is correct for everything. These splice.

Use the typed constructors ({@link list}, {@link constr}, {@link map}) when the children are
values this process produced. Use these when the children came off a wire and are going back on
one unchanged, which is every datum nested inside another datum.

The framing matches what the typed encoder writes under the Plutus data options, so the two
routes agree for any child that round-trips: non-empty lists and constructor fields are
indefinite, the empty list is definite, the tag-102 wrapper is definite, and a Plutus map is
definite and keeps the order it was given.

**Signature**

```ts
export declare const spliceList: (items: ReadonlyArray<Uint8Array>) => Uint8Array
```

Added in v2.8.0

## spliceMap

A Plutus map over already-encoded keys and values.

⚠️ Definite-framed, and the entries keep the order given: a Plutus map is NOT sorted. Sorting
it is a different value as far as a script reading it by position is concerned, and a different
hash either way.

See {@link spliceList} for when to reach for this rather than {@link map}.

**Signature**

```ts
export declare const spliceMap: (entries: ReadonlyArray<readonly [Uint8Array, Uint8Array]>) => Uint8Array
```

Added in v2.8.0

# equality

## equals

Schema-derived structural equality for Plutus Data values.
Handles maps, lists, ints, bytes, and constrs via the
recursive DataSchema definition — no hand-rolled comparison needed.

**Signature**

```ts
export declare const equals: (a: Data, b: Data) => boolean
```

Added in v2.0.0

## hash

Deep structural hash for Plutus Data values.
Handles maps, lists, ints, bytes, and constrs.

**Signature**

```ts
export declare const hash: (data: Data) => number
```

Added in v2.0.0

# errors

## DataError (class)

Error class for Data related operations.

**Signature**

```ts
export declare class DataError
```

Added in v2.0.0

# generators

## arbitrary

FastCheck arbitrary for PlutusData types

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<Data>
```

Added in v2.0.0

## arbitraryConstr

Creates an arbitrary that generates Constr values

**Signature**

```ts
export declare const arbitraryConstr: (depth: number) => FastCheck.Arbitrary<Constr>
```

Added in v2.0.0

## arbitraryPlutusBigInt

Creates an arbitrary that generates PlutusBigInt values

**Signature**

```ts
export declare const arbitraryPlutusBigInt: () => FastCheck.Arbitrary<bigint>
```

Added in v2.0.0

## arbitraryPlutusBytes

Creates an arbitrary that generates PlutusBytes values

**Signature**

```ts
export declare const arbitraryPlutusBytes: () => FastCheck.Arbitrary<Uint8Array>
```

Added in v2.0.0

## arbitraryPlutusData

Creates an arbitrary that generates PlutusData values with controlled depth

**Signature**

```ts
export declare const arbitraryPlutusData: (depth?: number) => FastCheck.Arbitrary<Data>
```

Added in v2.0.0

## arbitraryPlutusList

Creates an arbitrary that generates PlutusList values

**Signature**

```ts
export declare const arbitraryPlutusList: (depth: number) => FastCheck.Arbitrary<List>
```

Added in v2.0.0

## arbitraryPlutusMap

Creates an arbitrary that generates PlutusMap values with unique keys
Following a similar distribution pattern:

- 60% PlutusBigInt keys
- 30% PlutusBytes keys
- 10% Complex keys

**Signature**

```ts
export declare const arbitraryPlutusMap: (depth: number) => FastCheck.Arbitrary<Map>
```

Added in v2.0.0

# hashing

## ~~hashData~~

**Signature**

```ts
export declare const hashData: (data: Data, options?: CBOR.CodecOptions) => DatumHash.DatumHash
```

Added in v2.0.0

## toDatumHash

Compute the hash of PlutusData using blake2b-256 over its CBOR encoding.
Defaults to PLUTUS_DATA_OPTIONS, the node layout.

**Signature**

```ts
export declare const toDatumHash: (data: Data, options?: CBOR.CodecOptions) => DatumHash.DatumHash
```

**Example**

```typescript
import * as Data from "@evolution-sdk/evolution/Data"

// Hash a simple integer
const intData = 42n
const intHash = Data.toDatumHash(intData)

// Hash a constructor
const constr = new Data.Constr({ index: 0n, fields: [1n, 2n] })
const constrHash = Data.toDatumHash(constr)

// Hash a bytearray
const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
const bytesHash = Data.toDatumHash(bytes)
```

Added in v2.0.0

# model

## Data (type alias)

PlutusData type definition (runtime type)
Based on Conway CDDL specification

```
CDDL: plutus_data =
  constr<plutus_data>
  / {* plutus_data => plutus_data}
  / [* plutus_data]
  / big_int
  / bounded_bytes

constr<a0> =
  #6.121([* a0])
  / #6.122([* a0])
  / #6.123([* a0])
  / #6.124([* a0])
  / #6.125([* a0])
  / #6.126([* a0])
  / #6.127([* a0])
  / #6.102([uint, [* a0]])
```

Constructor Index Limits:

- Tags 121-127: Direct encoding for constructor indices 0-6
- Tag 102: General constructor encoding for any uint value
- Maximum constructor index: 2^64 - 1 (18,446,744,073,709,551,615)
  as per CBOR RFC 8949 specification for unsigned integers

**Signature**

```ts
export type Data =
  // Constr (runtime with bigint index)
  | Constr
  // Map (using standard Map since Schema.Map produces Map<K,V>)
  | globalThis.Map<Data, Data>
  // List
  | ReadonlyArray<Data>
  // Int (runtime as bigint)
  | bigint
  // ByteArray (runtime as Uint8Array)
  | Uint8Array
```

Added in v2.0.0

## DataEncoded (type alias)

PlutusData encoded type (for JSON/CBOR encoding)
Based on Conway CDDL specification

**Signature**

```ts
export type DataEncoded =
  // Constr (encoded with string index)
  | { readonly index: string; readonly fields: ReadonlyArray<DataEncoded> }
  // Map (encoded as array of [key, value] pairs)
  | ReadonlyArray<readonly [DataEncoded, DataEncoded]>
  // List
  | ReadonlyArray<DataEncoded>
  // Int (encoded as string)
  | string
  // ByteArray (encoded as hex string)
  | string
```

Added in v2.0.0

## Hex (type alias)

**Signature**

```ts
export type Hex = typeof Hex.Type
```

Added in v2.4.0

## List (type alias)

PlutusList type alias

**Signature**

```ts
export type List = ReadonlyArray<Data>
```

Added in v2.0.0

## Map (type alias)

PlutusMap type alias

**Signature**

```ts
export type Map = globalThis.Map<Data, Data>
```

Added in v2.0.0

# predicates

## isBytes

Type guard to check if a value is a PlutusBytes

**Signature**

```ts
export declare const isBytes: (u: unknown, overrideOptions?: ParseOptions | number) => u is Uint8Array
```

Added in v2.0.0

## isConstr

Type guard to check if a value is a Constr

**Signature**

```ts
export declare const isConstr: (data: unknown) => data is Constr
```

Added in v2.0.0

## isData

Whether a value is a {@link Data}, checked structurally and without rebuilding it.

**Signature**

```ts
export declare const isData: (input: unknown) => input is Data
```

Added in v2.8.0

## isInt

Type guard to check if a value is a PlutusBigInt

**Signature**

```ts
export declare const isInt: (u: unknown, overrideOptions?: ParseOptions | number) => u is bigint
```

Added in v2.0.0

## isList

Type guard to check if a value is a PlutusList

**Signature**

```ts
export declare const isList: (u: unknown, overrideOptions?: ParseOptions | number) => u is readonly Data[]
```

Added in v2.0.0

## isMap

Type guard to check if a value is a PlutusMap

**Signature**

```ts
export declare const isMap: (u: unknown, overrideOptions?: ParseOptions | number) => u is globalThis.Map<Data, Data>
```

Added in v2.0.0

# schemas

## ByteArray

Schema for PlutusBytes data type

**Signature**

```ts
export declare const ByteArray: Schema.Schema<Uint8Array, string, never>
```

Added in v2.0.0

## Constr (class)

Constr schema for constructor alternatives

**Signature**

```ts
export declare class Constr
```

Added in v2.0.0

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

## DataSchema

Combined schema for PlutusData type with proper recursion

**Signature**

```ts
export declare const DataSchema: DataSchema
```

Added in v2.0.0

## DataValue

A `Data` checked where it stands, with nothing rebuilt.

⚠️ **Use this for a class field or any other slot that holds an already-decoded `Data`.**
{@link DataSchema} is a transforming schema, and validating a value through it returns a
STRUCTURAL COPY: a list comes back as a different array holding the same elements. That is
invisible until something keys on identity, and {@link OriginalBytes} does -- so a datum decoded
from the wire and handed to `Redeemer.spend` arrived with its bytes and reached the encoder
without them, which reframed an empty indefinite list and moved `script_data_hash`.

`Schema.declare` with a type guard performs no transformation, so the value that goes in is the
value that comes out.

**Signature**

```ts
export declare const DataValue: Schema.Schema<Data, Data, never>
```

Added in v2.8.0

## FromCBORBytes

CBOR bytes transformation schema for PlutusData using CDDL.
Decodes through {@link FromCDDL}. Encodes as {@link toCBORBytes} does.

**Signature**

```ts
export declare const FromCBORBytes: (
  options?: CBOR.CodecOptions
) => Schema.transformOrFail<typeof Schema.Uint8ArrayFromSelf, Schema.SchemaClass<Data, Data, never>, never>
```

Added in v2.0.0

## FromCBORHex

CBOR hex transformation schema for PlutusData using CDDL.
Transforms between CBOR hex string and Data using CDDL encoding.

**Signature**

```ts
export declare const FromCBORHex: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.Schema<Uint8Array, string, never>,
  Schema.transformOrFail<typeof Schema.Uint8ArrayFromSelf, Schema.SchemaClass<Data, Data, never>, never>
>
```

Added in v2.0.0

## FromCDDL

CDDL schema for PlutusData following the Conway specification.

```
plutus_data =
  constr<plutus_data>
  / {* plutus_data => plutus_data}
  / [* plutus_data]
  / big_int
  / bounded_bytes

constr<a0> =
  #6.121([* a0])    // index 0
  / #6.122([* a0])  // index 1
  / #6.123([* a0])  // index 2
  / #6.124([* a0])  // index 3
  / #6.125([* a0])  // index 4
  / #6.126([* a0])  // index 5
  / #6.127([* a0])  // index 6
  / #6.102([uint, [* a0]])  // general constructor

big_int = int / big_uint / big_nint
big_uint = #6.2(bounded_bytes)
big_nint = #6.3(bounded_bytes)
```

This transforms between CBOR values and PlutusData using the existing
plutusDataToCBORValue and cborValueToPlutusData functions.

**Signature**

```ts
export declare const FromCDDL: Schema.transformOrFail<
  Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>,
  Schema.SchemaClass<Data, Data, never>,
  never
>
```

Added in v2.0.0

## Hex

A `plutus_data` item as CBOR hex.

⚠️ A script consumer matches a datum by its hash, so these bytes are the value: a re-encoding
that differs by one byte hashes differently.

Branded so that CBOR hex of one kind cannot stand in for another once it leaves the typed
domain. Non-empty whole bytes is all the shape there is to check.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "PlutusDataHex">
```

Added in v2.4.0

## IntSchema

Schema for PlutusBigInt data type

Matches the CDDL specification for big_int:

```
big_int = int / big_uint / big_nint
big_uint = #6.2(bounded_bytes)
big_nint = #6.3(bounded_bytes)
```

Where:

- `int` covers integers that fit in CBOR major types 0 and 1 (0 to 2^64-1 for positive, -(2^64-1) to -1 for negative)
- `big_uint` (tag 2) covers positive integers larger than 2^64-1
- `big_nint` (tag 3) covers negative integers smaller than -(2^64-1)

Note: JavaScript's Number.MAX_SAFE_INTEGER (2^53-1) is much smaller than CBOR's 64-bit limit.

**Signature**

```ts
export declare const IntSchema: Schema.transformOrFail<
  Schema.SchemaClass<string, string, never>,
  typeof Schema.BigIntFromSelf,
  never
>
```

Added in v2.0.0

## ListSchema

Schema for PlutusList data type

**Signature**

```ts
export declare const ListSchema: Schema.Array$<Schema.suspend<Data, DataEncoded, never>>
```

Added in v2.0.0

## MapSchema

Schema for PlutusMap data type

**Signature**

```ts
export declare const MapSchema: Schema.transform<
  Schema.Array$<Schema.Tuple2<Schema.suspend<Data, DataEncoded, never>, Schema.suspend<Data, DataEncoded, never>>>,
  Schema.MapFromSelf<Schema.SchemaClass<Data, Data, never>, Schema.SchemaClass<Data, Data, never>>
>
```

Added in v2.0.0

# transformation

## cborValueToPlutusData

Convert CBORValue to PlutusData

**Signature**

```ts
export declare const cborValueToPlutusData: (cborValue: CBOR.CBOR, fmt?: CBOR.CBORFormat) => Data
```

Added in v2.0.0

## fromCBORBytes

Decode PlutusData from CBOR bytes

**Signature**

```ts
export declare const fromCBORBytes: (bytes: Uint8Array, options?: CBOR.CodecOptions) => Data
```

Added in v2.0.0

## fromCBORHex

Decode PlutusData from CBOR hex string

**Signature**

```ts
export declare const fromCBORHex: (hex: string, options?: CBOR.CodecOptions) => Data
```

Added in v2.0.0

## plutusDataToCBORValue

Convert PlutusData to CBORValue

**Signature**

```ts
export declare const plutusDataToCBORValue: (data: Data, options?: CBOR.CodecOptions) => CBOR.CBOR
```

Added in v2.0.0

## toCBORBytes

Encode PlutusData to CBOR bytes.

`options` choose definite or indefinite lists and maps, map key order and
integer widths. These rules hold under every option:

- A byte string over 64 bytes is written indefinite, in 64-byte chunks.
- An integer from -2^64 to 2^64 - 1 is a CBOR integer. Outside that range it
  is a bignum (tag 2 or 3) whose bytes follow the byte string rule.
- A constructor index above 127 is tag 102 over a definite pair
  `[index, fields]`; only the fields follow `options`.

**Signature**

```ts
export declare const toCBORBytes: (data: Data, options?: CBOR.CodecOptions) => Uint8Array
```

Added in v2.0.0

## toCBORHex

Encode PlutusData to CBOR hex string, as {@link toCBORBytes} writes it.

**Signature**

```ts
export declare const toCBORHex: (data: Data, options?: CBOR.CodecOptions) => string
```

Added in v2.0.0

# utilities

## matchConstr

Pattern matching helper for Constr types

**Signature**

```ts
export declare const matchConstr: <T>(
  constr: Constr,
  cases: { [key: number]: (fields: ReadonlyArray<Data>) => T; _: (index: number, fields: ReadonlyArray<Data>) => T }
) => T
```

Added in v2.0.0

## matchData

Pattern matching helper for PlutusData types

**Signature**

```ts
export declare const matchData: <T>(
  data: Data,
  cases: {
    Map: (entries: ReadonlyArray<[Data, Data]>) => T
    List: (items: ReadonlyArray<Data>) => T
    Int: (value: bigint) => T
    Bytes: (bytes: Uint8Array) => T
    Constr: (constr: Constr) => T
  }
) => T
```

Added in v2.0.0

# utils

## ByteArray (type alias)

**Signature**

```ts
export type ByteArray = typeof ByteArray.Type
```

## CDDLSchema

**Signature**

```ts
export declare const CDDLSchema: Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>
```

## DataSchema (interface)

**Signature**

```ts
export interface DataSchema extends Schema.SchemaClass<Data, DataEncoded> {}
```

## Int (type alias)

**Signature**

```ts
export type Int = typeof IntSchema.Type
```
