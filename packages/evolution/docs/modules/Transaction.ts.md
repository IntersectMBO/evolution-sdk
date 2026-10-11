---

title: Transaction.ts
nav_order: 175
parent: Modules
---

## Transaction overview

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [fromEncoded](#fromencoded)
- [encoding](#encoding)
  - [addVKeyWitnesses](#addvkeywitnesses)
  - [addVKeyWitnessesBytes](#addvkeywitnessesbytes)
  - [addVKeyWitnessesHex](#addvkeywitnesseshex)
  - [extractBodyBytes](#extractbodybytes)
  - [getIntendedCodecOptions](#getintendedcodecoptions)
  - [setIntendedCodecOptions](#setintendedcodecoptions)
  - [toCBORBytesWithFormat](#tocborbyteswithformat)
  - [toCBORHexWithFormat](#tocborhexwithformat)
- [model](#model)
  - [Transaction (class)](#transaction-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
- [parsing](#parsing)
  - [fromCBORBytesWithFormat](#fromcborbyteswithformat)
  - [fromCBORHexWithFormat](#fromcborhexwithformat)
- [utils](#utils)
  - [CDDLSchema](#cddlschema)
  - [FromCBORBytes](#fromcborbytes)
  - [FromCBORHex](#fromcborhex)
  - [FromCDDL](#fromcddl)
  - [arbitrary](#arbitrary)
  - [cborHeaderSize](#cborheadersize)
  - [fromCBORBytes](#fromcborbytes-1)
  - [fromCBORHex](#fromcborhex-1)
  - [toCBORBytes](#tocborbytes)
  - [toCBORHex](#tocborhex)

---

# constructors

## fromEncoded

Assemble a signed transaction from a body and auxiliary data that are already encoded.

The body arrives as bytes because that is what was hashed and signed: decoding it and
re-encoding it is how a co-signed transaction acquires a different id than the one its first
signature covers. {@link fromCBORBytes} on `TransactionBody` records the arrival bytes, so the
body this carries re-encodes exactly, and `isValid` defaults to the only value a wallet submits.

**Signature**

```ts
export declare const fromEncoded: (input: {
  readonly body: Uint8Array
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
  readonly auxiliaryData?: Uint8Array
  readonly isValid?: boolean
}) => Transaction
```

Added in v2.8.0

# encoding

## addVKeyWitnesses

Add VKey witnesses to a transaction at the domain level.

This creates a new Transaction with the additional witnesses merged in.
All encoding metadata (body bytes, redeemers format, witness map structure)
is preserved so that txId and scriptDataHash remain stable.

**Signature**

```ts
export declare const addVKeyWitnesses: (
  tx: Transaction,
  witnesses: ReadonlyArray<TransactionWitnessSet.VKeyWitness>
) => Transaction
```

Added in v2.0.0

## addVKeyWitnessesBytes

Merge wallet vkey witnesses into a transaction, preserving CBOR encoding.

Uses the WithFormat round-trip: decode with format capture, mutate at the
domain level, re-encode with the original format tree. Body encoding,
redeemer bytes, map key ordering, and all non-witness data are preserved
through the format tree reconciliation.

`options` applies only to parsing the wallet witness set bytes. Transaction
decoding and re-encoding are governed by the captured format tree, making
codec options irrelevant for the transaction round-trip path.

**Signature**

```ts
export declare const addVKeyWitnessesBytes: (
  txBytes: Uint8Array,
  walletWitnessSetBytes: Uint8Array,
  options?: CBOR.CodecOptions
) => Uint8Array
```

Added in v2.0.0

## addVKeyWitnessesHex

Hex variant of `addVKeyWitnessesBytes`.

**Signature**

```ts
export declare const addVKeyWitnessesHex: (
  txHex: string,
  walletWitnessSetHex: string,
  options?: CBOR.CodecOptions
) => string
```

Added in v2.0.0

## extractBodyBytes

Extract the original body bytes from a raw transaction CBOR byte array.
A Cardano transaction is a 4-element CBOR array: `[body, witnessSet, isValid, auxiliaryData]`.
This returns the raw body bytes without decoding/re-encoding, preserving the exact CBOR encoding.

**Signature**

```ts
export declare const extractBodyBytes: (txBytes: Uint8Array) => Uint8Array
```

Added in v2.0.0

## getIntendedCodecOptions

The options this transaction is meant to be serialized with, if any were recorded.

**Signature**

```ts
export declare const getIntendedCodecOptions: (data: Transaction) => CBOR.CodecOptions | undefined
```

Added in v2.2.0

## setIntendedCodecOptions

Record the options this transaction is meant to be serialized with.

Intended for builders: a transaction whose hashes were computed under non-default options must
be encoded under those same options wherever it goes next.

**Signature**

```ts
export declare const setIntendedCodecOptions: (data: Transaction, options: CBOR.CodecOptions) => void
```

Added in v2.2.0

## toCBORBytesWithFormat

Convert a Transaction to CBOR bytes using an explicit root format tree.

The witness set is written as `TransactionWitnessSet.toCBORBytesWithFormat`
writes it.

**Signature**

```ts
export declare const toCBORBytesWithFormat: (data: Transaction, format: CBOR.CBORFormat) => Uint8Array
```

Added in v2.0.0

## toCBORHexWithFormat

Convert a Transaction to CBOR hex string using an explicit root format tree,
as in {@link toCBORBytesWithFormat}.

**Signature**

```ts
export declare const toCBORHexWithFormat: (data: Transaction, format: CBOR.CBORFormat) => string
```

Added in v2.0.0

# model

## Transaction (class)

Transaction based on Conway CDDL specification

CDDL: transaction =
[transaction_body, transaction_witness_set, bool, auxiliary_data / nil]

**Signature**

```ts
export declare class Transaction
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

## fromCBORBytesWithFormat

Parse a Transaction from CBOR bytes and return the root format tree.

**Signature**

```ts
export declare const fromCBORBytesWithFormat: (bytes: Uint8Array) => CBOR.DecodedWithFormat<Transaction>
```

Added in v2.0.0

## fromCBORHexWithFormat

Parse a Transaction from CBOR hex string and return the root format tree.

**Signature**

```ts
export declare const fromCBORHexWithFormat: (hex: string) => CBOR.DecodedWithFormat<Transaction>
```

Added in v2.0.0

# utils

## CDDLSchema

Conway CDDL schema for Transaction tuple structure.

CDDL: transaction = [transaction_body, transaction_witness_set, bool, auxiliary_data / nil]

**Signature**

```ts
export declare const CDDLSchema: Schema.declare<
  readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR],
  readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR],
  readonly [],
  never
>
```

## FromCBORBytes

CBOR bytes transformation schema for Transaction. The body and the witness
set are written as `TransactionBody.FromCBORBytes(options)` and
`TransactionWitnessSet.FromCBORBytes(options)` write them, the rest with
the `ledger` options. Plain options are read as `CBOR.toTxCodecOptions`
reads them.

**Signature**

```ts
export declare const FromCBORBytes: (
  options?: CBOR.TxCodecOptions | CBOR.CodecOptions
) => Schema.transformOrFail<
  typeof Schema.Uint8ArrayFromSelf,
  Schema.SchemaClass<Transaction, Transaction, never>,
  never
>
```

## FromCBORHex

CBOR hex transformation schema for Transaction, as in {@link FromCBORBytes}.

**Signature**

```ts
export declare const FromCBORHex: (
  options?: CBOR.TxCodecOptions | CBOR.CodecOptions
) => Schema.transform<
  Schema.Schema<Uint8Array, string, never>,
  Schema.transformOrFail<typeof Schema.Uint8ArrayFromSelf, Schema.SchemaClass<Transaction, Transaction, never>, never>
>
```

## FromCDDL

Transform between CDDL tuple and Transaction class.

**Signature**

```ts
export declare const FromCDDL: Schema.transformOrFail<
  Schema.declare<
    readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR],
    readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR],
    readonly [],
    never
  >,
  Schema.SchemaClass<Transaction, Transaction, never>,
  never
>
```

## arbitrary

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<Transaction>
```

## cborHeaderSize

The byte width of the CBOR item header at `offset`.

Paired with {@link CBOR.decodeItemWithOffset} this is what slices an element out of a CBOR
array **byte-exactly** — `decodeItemWithOffset` gives the end of an item, this gives the start
of the first one inside a container. `extractBodyBytes` is one such slice; a wallet that
reviews a transaction before signing needs the same for the witness set and the auxiliary
data, and a re-encode is not a substitute because a span that differs by one byte is a
different transaction id.

**Signature**

```ts
export declare const cborHeaderSize: (data: Uint8Array, offset: number) => number
```

Added in v2.2.0

## fromCBORBytes

**Signature**

```ts
export declare const fromCBORBytes: (bytes: Uint8Array, options?: CBOR.CodecOptions) => Transaction
```

## fromCBORHex

**Signature**

```ts
export declare const fromCBORHex: (hex: string, options?: CBOR.CodecOptions) => Transaction
```

## toCBORBytes

**Signature**

```ts
export declare const toCBORBytes: (data: Transaction, options?: CBOR.TxCodecOptions | CBOR.CodecOptions) => Uint8Array
```

## toCBORHex

**Signature**

```ts
export declare const toCBORHex: (data: Transaction, options?: CBOR.TxCodecOptions | CBOR.CodecOptions) => string
```
