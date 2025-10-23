---
title: core/Script.ts
nav_order: 97
parent: Modules
---

## Script overview

---

<h2 class="text-delta">Table of contents</h2>

- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [equality](#equality)
  - [equals](#equals)
- [errors](#errors)
  - [ScriptError (class)](#scripterror-class)
- [model](#model)
  - [Script](#script)
- [schemas](#schemas)
  - [FromCDDL](#fromcddl)
  - [ScriptCDDL](#scriptcddl)
- [utils](#utils)
  - [Script (type alias)](#script-type-alias)
  - [ScriptCDDL (type alias)](#scriptcddl-type-alias)
  - [fromCBOR](#fromcbor)
  - [fromCBORHex](#fromcborhex)
  - [toCBOR](#tocbor)
  - [toCBORHex](#tocborhex)

---

# arbitrary

## arbitrary

FastCheck arbitrary for Script.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<
  NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3
>
```

Added in v2.0.0

# equality

## equals

Check if two Script instances are equal.

**Signature**

```ts
export declare const equals: (a: Script, b: Script) => boolean
```

Added in v2.0.0

# errors

## ScriptError (class)

Error class for Script related operations.

**Signature**

```ts
export declare class ScriptError
```

Added in v2.0.0

# model

## Script

Script union type following Conway CDDL specification.

CDDL:

```
script =
  [ 0, native_script ]
/ [ 1, plutus_v1_script ]
/ [ 2, plutus_v2_script ]
/ [ 3, plutus_v3_script ]
```

**Signature**

```ts
export declare const Script: Schema.Union<
  [typeof NativeScripts.NativeScript, typeof PlutusV1.PlutusV1, typeof PlutusV2.PlutusV2, typeof PlutusV3.PlutusV3]
>
```

Added in v2.0.0

# schemas

## FromCDDL

Transformation between CDDL representation and Script union.

**Signature**

```ts
export declare const FromCDDL: Schema.transformOrFail<
  Schema.Union<
    [
      Schema.Tuple2<
        Schema.Literal<[0n]>,
        Schema.Schema<NativeScripts.NativeScriptCDDL, NativeScripts.NativeScriptCDDL, never>
      >,
      Schema.Tuple2<Schema.Literal<[1n]>, typeof Schema.Uint8ArrayFromSelf>,
      Schema.Tuple2<Schema.Literal<[2n]>, typeof Schema.Uint8ArrayFromSelf>,
      Schema.Tuple2<Schema.Literal<[3n]>, typeof Schema.Uint8ArrayFromSelf>
    ]
  >,
  Schema.SchemaClass<
    NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3,
    NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3,
    never
  >,
  never
>
```

Added in v2.0.0

## ScriptCDDL

CDDL schema for Script as tagged tuples.

**Signature**

```ts
export declare const ScriptCDDL: Schema.Union<
  [
    Schema.Tuple2<
      Schema.Literal<[0n]>,
      Schema.Schema<NativeScripts.NativeScriptCDDL, NativeScripts.NativeScriptCDDL, never>
    >,
    Schema.Tuple2<Schema.Literal<[1n]>, typeof Schema.Uint8ArrayFromSelf>,
    Schema.Tuple2<Schema.Literal<[2n]>, typeof Schema.Uint8ArrayFromSelf>,
    Schema.Tuple2<Schema.Literal<[3n]>, typeof Schema.Uint8ArrayFromSelf>
  ]
>
```

Added in v2.0.0

# utils

## Script (type alias)

**Signature**

```ts
export type Script = typeof Script.Type
```

## ScriptCDDL (type alias)

**Signature**

```ts
export type ScriptCDDL = typeof ScriptCDDL.Type
```

## fromCBOR

**Signature**

```ts
export declare const fromCBOR: (
  bytes: Uint8Array,
  options?: CBOR.CodecOptions
) => NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3
```

## fromCBORHex

**Signature**

```ts
export declare const fromCBORHex: (
  hex: string,
  options?: CBOR.CodecOptions
) => NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3
```

## toCBOR

**Signature**

```ts
export declare const toCBOR: (
  input: NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3,
  options?: CBOR.CodecOptions
) => Uint8Array
```

## toCBORHex

**Signature**

```ts
export declare const toCBORHex: (
  input: NativeScripts.NativeScript | PlutusV1.PlutusV1 | PlutusV2.PlutusV2 | PlutusV3.PlutusV3,
  options?: CBOR.CodecOptions
) => string
```
