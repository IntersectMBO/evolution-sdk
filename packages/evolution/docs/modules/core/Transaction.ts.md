---
title: core/Transaction.ts
nav_order: 106
parent: Modules
---

## Transaction overview

---

<h2 class="text-delta">Table of contents</h2>

- [errors](#errors)
  - [TransactionError (class)](#transactionerror-class)
- [model](#model)
  - [Transaction (class)](#transaction-class)
- [utils](#utils)
  - [CDDLSchema](#cddlschema)
  - [Either (namespace)](#either-namespace)
  - [FromCBORBytes](#fromcborbytes)
  - [FromCBORHex](#fromcborhex)
  - [FromCDDL](#fromcddl)
  - [arbitrary](#arbitrary)
  - [equals](#equals)
  - [fromCBORBytes](#fromcborbytes-1)
  - [fromCBORHex](#fromcborhex-1)
  - [make](#make)
  - [toCBORBytes](#tocborbytes)
  - [toCBORHex](#tocborhex)

---

# errors

## TransactionError (class)

Error class for Transaction related operations.

**Signature**

```ts
export declare class TransactionError
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

# utils

## CDDLSchema

Conway CDDL schema for Transaction tuple structure.

CDDL: transaction = [transaction_body, transaction_witness_set, bool, auxiliary_data / nil]

**Signature**

```ts
export declare const CDDLSchema: Schema.Tuple<
  [
    Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
    Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
    typeof Schema.Boolean,
    Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>
  ]
>
```

## Either (namespace)

## FromCBORBytes

CBOR bytes transformation schema for Transaction.

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
    Schema.Tuple<
      [
        Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
        Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
        typeof Schema.Boolean,
        Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>
      ]
    >,
    Schema.SchemaClass<Transaction, Transaction, never>,
    never
  >
>
```

## FromCBORHex

CBOR hex transformation schema for Transaction.

**Signature**

```ts
export declare const FromCBORHex: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.transform<
    Schema.transform<Schema.Schema<string, string, never>, Schema.Schema<Uint8Array, Uint8Array, never>>,
    Schema.transformOrFail<
      typeof Schema.Uint8ArrayFromSelf,
      Schema.declare<CBOR.CBOR, CBOR.CBOR, readonly [], never>,
      never
    >
  >,
  Schema.transformOrFail<
    Schema.Tuple<
      [
        Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
        Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
        typeof Schema.Boolean,
        Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>
      ]
    >,
    Schema.SchemaClass<Transaction, Transaction, never>,
    never
  >
>
```

## FromCDDL

Transform between CDDL tuple and Transaction class.

**Signature**

```ts
export declare const FromCDDL: Schema.transformOrFail<
  Schema.Tuple<
    [
      Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
      Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
      typeof Schema.Boolean,
      Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>
    ]
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

## equals

**Signature**

```ts
export declare const equals: (a: Transaction, b: Transaction) => boolean
```

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

## make

**Signature**

```ts
export declare const make: (
  props: {
    readonly body: TransactionBody.TransactionBody
    readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
    readonly isValid: boolean
    readonly auxiliaryData:
      | AuxiliaryData.ConwayAuxiliaryData
      | AuxiliaryData.ShelleyMAAuxiliaryData
      | AuxiliaryData.ShelleyAuxiliaryData
      | null
  },
  options?: Schema.MakeOptions | undefined
) => Transaction
```

## toCBORBytes

**Signature**

```ts
export declare const toCBORBytes: (input: Transaction, options?: CBOR.CodecOptions) => Uint8Array
```

## toCBORHex

**Signature**

```ts
export declare const toCBORHex: (input: Transaction, options?: CBOR.CodecOptions) => string
```
