---
title: core/TransactionOutput.ts
nav_order: 113
parent: Modules
---

## TransactionOutput overview

---

<h2 class="text-delta">Table of contents</h2>

- [Either](#either)
  - [Either (namespace)](#either-namespace)
- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [constructors](#constructors)
  - [makeBabbage](#makebabbage)
  - [makeShelley](#makeshelley)
- [decoding](#decoding)
  - [fromCBORBytes](#fromcborbytes)
  - [fromCBORHex](#fromcborhex)
- [encoding](#encoding)
  - [toCBORBytes](#tocborbytes)
  - [toCBORHex](#tocborhex)
- [equality](#equality)
  - [equals](#equals)
- [errors](#errors)
  - [TransactionOutputError (class)](#transactionoutputerror-class)
- [model](#model)
  - [BabbageTransactionOutput (class)](#babbagetransactionoutput-class)
    - [toString (method)](#tostring-method)
    - [[Symbol.for("nodejs.util.inspect.custom")] (method)](#symbolfornodejsutilinspectcustom-method)
  - [ShelleyTransactionOutput (class)](#shelleytransactionoutput-class)
    - [toString (method)](#tostring-method-1)
    - [[Symbol.for("nodejs.util.inspect.custom")] (method)](#symbolfornodejsutilinspectcustom-method-1)
- [schemas](#schemas)
  - [TransactionOutput](#transactionoutput)
- [transformation](#transformation)
  - [FromBabbageTransactionOutputCDDLSchema](#frombabbagetransactionoutputcddlschema)
  - [FromShelleyTransactionOutputCDDLSchema](#fromshelleytransactionoutputcddlschema)
- [transformer](#transformer)
  - [FromCBORBytes](#fromcborbytes-1)
  - [FromCBORHex](#fromcborhex-1)
  - [FromCDDL](#fromcddl)
- [utils](#utils)
  - [CDDLSchema](#cddlschema)
  - [ShelleyTransactionOutputCDDL](#shelleytransactionoutputcddl)
  - [TransactionOutput (type alias)](#transactionoutput-type-alias)

---

# Either

## Either (namespace)

Either namespace containing schema decode and encode operations.

Added in v2.0.0

# arbitrary

## arbitrary

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<ShelleyTransactionOutput | BabbageTransactionOutput>
```

Added in v2.0.0

# constructors

## makeBabbage

Create a Babbage transaction output.

**Signature**

```ts
export declare const makeBabbage: (
  props: {
    readonly address:
      | RewardAccount
      | BaseAddress.BaseAddress
      | EnterpriseAddress.EnterpriseAddress
      | PointerAddress
      | ByronAddress
    readonly amount: Value.OnlyCoin | Value.WithAssets
    readonly datumOption?: DatumOption.DatumHash | DatumOption.InlineDatum | undefined
    readonly scriptRef?: ScriptRef.ScriptRef | undefined
  },
  options?: Schema.MakeOptions | undefined
) => BabbageTransactionOutput
```

Added in v2.0.0

## makeShelley

Create a Shelley transaction output.

**Signature**

```ts
export declare const makeShelley: (
  props: {
    readonly datumHash?: DatumOption.DatumHash | undefined
    readonly address:
      | RewardAccount
      | BaseAddress.BaseAddress
      | EnterpriseAddress.EnterpriseAddress
      | PointerAddress
      | ByronAddress
    readonly amount: Value.OnlyCoin | Value.WithAssets
  },
  options?: Schema.MakeOptions | undefined
) => ShelleyTransactionOutput
```

Added in v2.0.0

# decoding

## fromCBORBytes

Parse TransactionOutput from CBOR bytes (unsafe).

**Signature**

```ts
export declare const fromCBORBytes: (
  bytes: Uint8Array,
  options?: CBOR.CodecOptions
) => ShelleyTransactionOutput | BabbageTransactionOutput
```

Added in v2.0.0

## fromCBORHex

Parse TransactionOutput from CBOR hex (unsafe).

**Signature**

```ts
export declare const fromCBORHex: (
  hex: string,
  options?: CBOR.CodecOptions
) => ShelleyTransactionOutput | BabbageTransactionOutput
```

Added in v2.0.0

# encoding

## toCBORBytes

Convert TransactionOutput to CBOR bytes (unsafe).

**Signature**

```ts
export declare const toCBORBytes: (
  input: ShelleyTransactionOutput | BabbageTransactionOutput,
  options?: CBOR.CodecOptions
) => Uint8Array
```

Added in v2.0.0

## toCBORHex

Convert TransactionOutput to CBOR hex (unsafe).

**Signature**

```ts
export declare const toCBORHex: (
  input: ShelleyTransactionOutput | BabbageTransactionOutput,
  options?: CBOR.CodecOptions
) => string
```

Added in v2.0.0

# equality

## equals

Check if two TransactionOutput instances are equal.

**Signature**

```ts
export declare const equals: (a: TransactionOutput, b: TransactionOutput) => boolean
```

Added in v2.0.0

# errors

## TransactionOutputError (class)

Error class for TransactionOutput related operations.

**Signature**

```ts
export declare class TransactionOutputError
```

Added in v2.0.0

# model

## BabbageTransactionOutput (class)

Babbage-era transaction output format

CDDL:

```
babbage_transaction_output =
  {0 : address, 1 : value, ? 2 : datum_option, ? 3 : script_ref}
```

**Signature**

```ts
export declare class BabbageTransactionOutput
```

Added in v2.0.0

### toString (method)

**Signature**

```ts
toString(): string
```

### [Symbol.for("nodejs.util.inspect.custom")] (method)

**Signature**

```ts
[Symbol.for("nodejs.util.inspect.custom")](): string
```

## ShelleyTransactionOutput (class)

Shelley-era transaction output format

CDDL:

```
shelley_transaction_output = [address, amount : value, ? Bytes32]
```

**Signature**

```ts
export declare class ShelleyTransactionOutput
```

Added in v2.0.0

### toString (method)

**Signature**

```ts
toString(): string
```

### [Symbol.for("nodejs.util.inspect.custom")] (method)

**Signature**

```ts
[Symbol.for("nodejs.util.inspect.custom")](): string
```

# schemas

## TransactionOutput

Union type for transaction outputs

CDDL:

```
transaction_output = shelley_transaction_output / babbage_transaction_output
```

**Signature**

```ts
export declare const TransactionOutput: Schema.Union<[typeof ShelleyTransactionOutput, typeof BabbageTransactionOutput]>
```

Added in v2.0.0

# transformation

## FromBabbageTransactionOutputCDDLSchema

CDDL schema for Babbage transaction outputs

**Signature**

```ts
export declare const FromBabbageTransactionOutputCDDLSchema: Schema.transformOrFail<
  Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
  Schema.SchemaClass<BabbageTransactionOutput, BabbageTransactionOutput, never>,
  never
>
```

Added in v2.0.0

## FromShelleyTransactionOutputCDDLSchema

CDDL schema for Shelley transaction outputs

**Signature**

```ts
export declare const FromShelleyTransactionOutputCDDLSchema: Schema.transformOrFail<
  Schema.Tuple<
    [
      typeof Schema.Uint8ArrayFromSelf,
      Schema.Union<
        [
          typeof Schema.BigIntFromSelf,
          Schema.Tuple2<
            typeof Schema.BigIntFromSelf,
            Schema.SchemaClass<
              ReadonlyMap<any, ReadonlyMap<any, bigint>>,
              ReadonlyMap<any, ReadonlyMap<any, bigint>>,
              never
            >
          >
        ]
      >,
      Schema.Element<typeof Schema.Uint8ArrayFromSelf, "?">
    ]
  >,
  Schema.SchemaClass<ShelleyTransactionOutput, ShelleyTransactionOutput, never>,
  never
>
```

Added in v2.0.0

# transformer

## FromCBORBytes

CBOR bytes transformation schema for TransactionOutput.

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
  Schema.Union<
    [
      Schema.transformOrFail<
        Schema.Tuple<
          [
            typeof Schema.Uint8ArrayFromSelf,
            Schema.Union<
              [
                typeof Schema.BigIntFromSelf,
                Schema.Tuple2<
                  typeof Schema.BigIntFromSelf,
                  Schema.SchemaClass<
                    ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                    ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                    never
                  >
                >
              ]
            >,
            Schema.Element<typeof Schema.Uint8ArrayFromSelf, "?">
          ]
        >,
        Schema.SchemaClass<ShelleyTransactionOutput, ShelleyTransactionOutput, never>,
        never
      >,
      Schema.transformOrFail<
        Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
        Schema.SchemaClass<BabbageTransactionOutput, BabbageTransactionOutput, never>,
        never
      >
    ]
  >
>
```

Added in v2.0.0

## FromCBORHex

CBOR hex transformation schema for TransactionOutput.

**Signature**

```ts
export declare const FromCBORHex: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.transform<Schema.Schema<string, string, never>, Schema.Schema<Uint8Array, Uint8Array, never>>,
  Schema.transform<
    Schema.transformOrFail<
      typeof Schema.Uint8ArrayFromSelf,
      Schema.declare<CBOR.CBOR, CBOR.CBOR, readonly [], never>,
      never
    >,
    Schema.Union<
      [
        Schema.transformOrFail<
          Schema.Tuple<
            [
              typeof Schema.Uint8ArrayFromSelf,
              Schema.Union<
                [
                  typeof Schema.BigIntFromSelf,
                  Schema.Tuple2<
                    typeof Schema.BigIntFromSelf,
                    Schema.SchemaClass<
                      ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                      ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                      never
                    >
                  >
                ]
              >,
              Schema.Element<typeof Schema.Uint8ArrayFromSelf, "?">
            ]
          >,
          Schema.SchemaClass<ShelleyTransactionOutput, ShelleyTransactionOutput, never>,
          never
        >,
        Schema.transformOrFail<
          Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
          Schema.SchemaClass<BabbageTransactionOutput, BabbageTransactionOutput, never>,
          never
        >
      ]
    >
  >
>
```

Added in v2.0.0

## FromCDDL

CDDL schema for transaction outputs

**Signature**

```ts
export declare const FromCDDL: Schema.Union<
  [
    Schema.transformOrFail<
      Schema.Tuple<
        [
          typeof Schema.Uint8ArrayFromSelf,
          Schema.Union<
            [
              typeof Schema.BigIntFromSelf,
              Schema.Tuple2<
                typeof Schema.BigIntFromSelf,
                Schema.SchemaClass<
                  ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                  ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                  never
                >
              >
            ]
          >,
          Schema.Element<typeof Schema.Uint8ArrayFromSelf, "?">
        ]
      >,
      Schema.SchemaClass<ShelleyTransactionOutput, ShelleyTransactionOutput, never>,
      never
    >,
    Schema.transformOrFail<
      Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>,
      Schema.SchemaClass<BabbageTransactionOutput, BabbageTransactionOutput, never>,
      never
    >
  ]
>
```

Added in v2.0.0

# utils

## CDDLSchema

**Signature**

```ts
export declare const CDDLSchema: Schema.Union<
  [
    Schema.Tuple<
      [
        typeof Schema.Uint8ArrayFromSelf,
        Schema.Union<
          [
            typeof Schema.BigIntFromSelf,
            Schema.Tuple2<
              typeof Schema.BigIntFromSelf,
              Schema.SchemaClass<
                ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                ReadonlyMap<any, ReadonlyMap<any, bigint>>,
                never
              >
            >
          ]
        >,
        Schema.Element<typeof Schema.Uint8ArrayFromSelf, "?">
      ]
    >,
    Schema.MapFromSelf<typeof Schema.BigIntFromSelf, Schema.Schema<CBOR.CBOR, CBOR.CBOR, never>>
  ]
>
```

## ShelleyTransactionOutputCDDL

**Signature**

```ts
export declare const ShelleyTransactionOutputCDDL: Schema.Tuple<
  [
    typeof Schema.Uint8ArrayFromSelf,
    Schema.Union<
      [
        typeof Schema.BigIntFromSelf,
        Schema.Tuple2<
          typeof Schema.BigIntFromSelf,
          Schema.SchemaClass<
            ReadonlyMap<any, ReadonlyMap<any, bigint>>,
            ReadonlyMap<any, ReadonlyMap<any, bigint>>,
            never
          >
        >
      ]
    >,
    Schema.Element<typeof Schema.Uint8ArrayFromSelf, "?">
  ]
>
```

## TransactionOutput (type alias)

**Signature**

```ts
export type TransactionOutput = typeof TransactionOutput.Type
```
