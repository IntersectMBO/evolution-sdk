---

title: CBOR.ts
nav_order: 34
parent: Modules
---

## CBOR overview

---

<h2 class="text-delta">Table of contents</h2>

- [constants](#constants)
  - [~~AIKEN_DEFAULT_OPTIONS~~](#aiken_default_options)
  - [CANONICAL_OPTIONS](#canonical_options)
  - [~~CARDANO_NODE_DATA_OPTIONS~~](#cardano_node_data_options)
  - [CBOR_ADDITIONAL_INFO](#cbor_additional_info)
  - [CBOR_MAJOR_TYPE](#cbor_major_type)
  - [CBOR_SIMPLE](#cbor_simple)
  - [~~CML_DATA_DEFAULT_OPTIONS~~](#cml_data_default_options)
  - [CML_DATA_DEFINITE_OPTIONS](#cml_data_definite_options)
  - [CML_DEFAULT_OPTIONS](#cml_default_options)
  - [PLUTUS_DATA_OPTIONS](#plutus_data_options)
  - [STRUCT_FRIENDLY_OPTIONS](#struct_friendly_options)
  - [TX_CANONICAL_OPTIONS](#tx_canonical_options)
  - [TX_DEFAULT_OPTIONS](#tx_default_options)
- [decoding](#decoding)
  - [decodeItemWithOffset](#decodeitemwithoffset)
  - [decodeItemWithOffsetAndFormat](#decodeitemwithoffsetandformat)
  - [splitArrayItems](#splitarrayitems)
  - [splitMapEntries](#splitmapentries)
- [encoding](#encoding)
  - [compareByteKeys](#comparebytekeys)
  - [encodeMapAsDefinite](#encodemapasdefinite)
  - [encodeTaggedSet](#encodetaggedset)
  - [sortByteKeyedMap](#sortbytekeyedmap)
  - [toCBORBytes](#tocborbytes)
  - [toCBORBytesWithFormat](#tocborbyteswithformat)
  - [toCBORHex](#tocborhex)
  - [toCBORHexWithFormat](#tocborhexwithformat)
- [equality](#equality)
  - [equals](#equals)
- [errors](#errors)
  - [CBORError (class)](#cborerror-class)
- [model](#model)
  - [BoundedBytes](#boundedbytes)
  - [ByteSize (type alias)](#bytesize-type-alias)
  - [CBOR (type alias)](#cbor-type-alias)
  - [CBORFormat (type alias)](#cborformat-type-alias)
  - [CBORFormat (namespace)](#cborformat-namespace)
    - [Array (type alias)](#array-type-alias)
    - [Bytes (type alias)](#bytes-type-alias)
    - [Map (type alias)](#map-type-alias)
    - [NInt (type alias)](#nint-type-alias)
    - [Simple (type alias)](#simple-type-alias)
    - [Tag (type alias)](#tag-type-alias)
    - [Text (type alias)](#text-type-alias)
    - [UInt (type alias)](#uint-type-alias)
  - [CodecOptions (type alias)](#codecoptions-type-alias)
  - [DecodedWithFormat (type alias)](#decodedwithformat-type-alias)
  - [DefiniteArray](#definitearray)
  - [LengthEncoding (type alias)](#lengthencoding-type-alias)
  - [Raw](#raw)
  - [StringEncoding (type alias)](#stringencoding-type-alias)
  - [TxCodecOptions (type alias)](#txcodecoptions-type-alias)
- [parsing](#parsing)
  - [fromCBORBytes](#fromcborbytes)
  - [fromCBORBytesWithFormat](#fromcborbyteswithformat)
  - [fromCBORHex](#fromcborhex)
  - [fromCBORHexWithFormat](#fromcborhexwithformat)
  - [internalDecodeWithFormatSync](#internaldecodewithformatsync)
- [schemas](#schemas)
  - [CBORSchema](#cborschema)
  - [FromBytes](#frombytes)
  - [Integer](#integer)
- [transformation](#transformation)
  - [match](#match)
  - [toTxCodecOptions](#totxcodecoptions)
- [utils](#utils)
  - [ArraySchema](#arrayschema)
  - [ByteArray](#bytearray)
  - [Either (namespace)](#either-namespace)
  - [Float](#float)
  - [FromHex](#fromhex)
  - [MapSchema](#mapschema)
  - [RecordSchema](#recordschema)
  - [Simple](#simple)
  - [Tag](#tag)
  - [Text](#text)
  - [encodeArrayAsDefinite](#encodearrayasdefinite)
  - [encodeArrayAsIndefinite](#encodearrayasindefinite)
  - [encodeTaggedValue](#encodetaggedvalue)
  - [internalDecodeSync](#internaldecodesync)
  - [internalEncodeSync](#internalencodesync)
  - [isArray](#isarray)
  - [isByteArray](#isbytearray)
  - [isInteger](#isinteger)
  - [isMap](#ismap)
  - [isRecord](#isrecord)
  - [isTag](#istag)
  - [map](#map)
  - [tag](#tag-1)

---

# constants

## ~~AIKEN_DEFAULT_OPTIONS~~

Aiken `cbor.serialise()` encoding options. Same object as
{@link PLUTUS_DATA_OPTIONS}.

Aiken writes data in the node layout: non-empty lists and constructor
fields indefinite, `Pairs` as definite maps. Tuples are lists, so they
encode as indefinite arrays.

**Signature**

```ts
export declare const AIKEN_DEFAULT_OPTIONS: CodecOptions
```

Added in v2.0.0

## CANONICAL_OPTIONS

Canonical CBOR encoding options (RFC 8949 Section 4.2.1)

**Signature**

```ts
export declare const CANONICAL_OPTIONS: CodecOptions
```

Added in v1.0.0

## ~~CARDANO_NODE_DATA_OPTIONS~~

Definite-length PlutusData encoding options. Same object as
{@link CML_DATA_DEFINITE_OPTIONS}.

The name is wrong: the Cardano node writes non-empty lists and constructor
fields indefinite. For the node layout use {@link PLUTUS_DATA_OPTIONS}.

**Signature**

```ts
export declare const CARDANO_NODE_DATA_OPTIONS: CodecOptions
```

Added in v2.0.0

## CBOR_ADDITIONAL_INFO

CBOR additional information constants

**Signature**

```ts
export declare const CBOR_ADDITIONAL_INFO: {
  readonly DIRECT: 24
  readonly UINT16: 25
  readonly UINT32: 26
  readonly UINT64: 27
  readonly INDEFINITE: 31
}
```

Added in v1.0.0

## CBOR_MAJOR_TYPE

CBOR major types as constants

**Signature**

```ts
export declare const CBOR_MAJOR_TYPE: {
  readonly UNSIGNED_INTEGER: 0
  readonly NEGATIVE_INTEGER: 1
  readonly BYTE_STRING: 2
  readonly TEXT_STRING: 3
  readonly ARRAY: 4
  readonly MAP: 5
  readonly TAG: 6
  readonly SIMPLE_FLOAT: 7
}
```

Added in v1.0.0

## CBOR_SIMPLE

Simple value constants for CBOR

**Signature**

```ts
export declare const CBOR_SIMPLE: { readonly FALSE: 20; readonly TRUE: 21; readonly NULL: 22; readonly UNDEFINED: 23 }
```

Added in v1.0.0

## ~~CML_DATA_DEFAULT_OPTIONS~~

CBOR encoding options for PlutusData with non-empty lists, constructor
fields and maps indefinite, map keys in the order given. This was the
`Data` default before {@link PLUTUS_DATA_OPTIONS}.

It matches no tool exactly. The node, cardano-cli and Aiken write maps
definite. CML 6.2.0 `PlutusData.to_cardano_node_format()` writes maps
indefinite but also sorts map keys. For a constructor index above 127 the
Plutus data encoder writes the tag 102 `[index, fields]` pair definite
under every preset, including this one. Use it only to reproduce the bytes
and datum hashes the SDK wrote before {@link PLUTUS_DATA_OPTIONS} became
the default.

**Signature**

```ts
export declare const CML_DATA_DEFAULT_OPTIONS: CodecOptions
```

Added in v1.0.0

## CML_DATA_DEFINITE_OPTIONS

CBOR encoding options for PlutusData matching CML `PlutusData.to_cbor_hex()`
on freshly built data.

Uses definite-length lists, constructor fields, and maps. It differs from
the node layout ({@link PLUTUS_DATA_OPTIONS}) by writing lists and
constructor fields definite.

**Signature**

```ts
export declare const CML_DATA_DEFINITE_OPTIONS: CodecOptions
```

Added in v2.0.0

## CML_DEFAULT_OPTIONS

Default CBOR encoding options

**Signature**

```ts
export declare const CML_DEFAULT_OPTIONS: CodecOptions
```

Added in v1.0.0

## PLUTUS_DATA_OPTIONS

CBOR encoding options for PlutusData in the layout the Cardano node writes.

- Non-empty lists and constructor fields: indefinite-length (`9f...ff`)
- Maps: definite-length
- Empty list: `80`; empty map: `a0`

The `Data` default. `Data.toCBORBytes` with these options writes the bytes
the node writes.
The rules that do not depend on options are applied by the Plutus data
encoder under every preset: byte strings over 64 bytes in 64-byte chunks,
bignums only outside -2^64 to 2^64 - 1 with their bytes chunked the same
way, and a definite `[index, fields]` pair under tag 102.

**Signature**

```ts
export declare const PLUTUS_DATA_OPTIONS: CodecOptions
```

Added in v2.0.0

## STRUCT_FRIENDLY_OPTIONS

CBOR encoding options that return objects instead of Maps for Schema.Struct compatibility

**Signature**

```ts
export declare const STRUCT_FRIENDLY_OPTIONS: CodecOptions
```

Added in v2.0.0

## TX_CANONICAL_OPTIONS

Canonical options for a transaction: {@link CANONICAL_OPTIONS} for both
ledger structures and Plutus data.

**Signature**

```ts
export declare const TX_CANONICAL_OPTIONS: TxCodecOptions
```

Added in v2.0.0

## TX_DEFAULT_OPTIONS

Default options for a transaction.

- `ledger` is {@link CML_DEFAULT_OPTIONS}, CML's transaction encoding: map
  keys in insertion order, definite lengths.
- `plutusData` is {@link PLUTUS_DATA_OPTIONS}, the `Data` default.

It does not match cardano-cli, which sorts map keys and writes indefinite
lengths above 23 entries.

**Signature**

```ts
export declare const TX_DEFAULT_OPTIONS: TxCodecOptions
```

Added in v2.0.0

# decoding

## decodeItemWithOffset

Decode a single CBOR item at a given byte offset, returning the decoded value and the new offset.
Useful for extracting raw byte slices from CBOR-encoded data without re-encoding.

**Signature**

```ts
export declare const decodeItemWithOffset: (
  data: Uint8Array,
  offset: number,
  options?: CodecOptions
) => { item: CBOR; newOffset: number }
```

Added in v2.0.0

## decodeItemWithOffsetAndFormat

Decode one item at `offset`, keeping the per-node encoding metadata.

The format-blind {@link decodeItemWithOffset} is enough to measure or skip an item; this is for
callers that must re-encode it byte for byte afterwards, where the definite/indefinite framing and
head widths have to survive the round trip.

**Signature**

```ts
export declare const decodeItemWithOffsetAndFormat: (
  data: Uint8Array,
  offset: number,
  options?: CodecOptions
) => { item: CBOR; format: CBORFormat; newOffset: number }
```

Added in v2.0.0

## splitArrayItems

Split an encoded CBOR array into the ORIGINAL bytes of each of its items.

A `#6.258` tag around the array is accepted and stepped over, so a ledger set and a bare array
are both read; the tag itself is not part of any item.

⚠️ **Use this instead of decoding an array and re-encoding its items.** Decode-then-re-encode
runs every item through an encoder, which means every item comes back in whatever shape the
options in force describe rather than the shape it arrived in. For `plutus_data` that moves
`script_data_hash`; for a certificate or a script it changes the transaction id. This returns
slices of the input, so there is no encoder in the path and nothing to configure wrongly.

The items are _not_ validated beyond being well-formed CBOR, because the caller is about to
decode each one into whatever it expects.

**Signature**

```ts
export declare const splitArrayItems: (bytes: Uint8Array) => ReadonlyArray<Uint8Array>
```

**Example**

```ts
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import * as Bytes from "@evolution-sdk/evolution/Bytes"

// An indefinite empty Plutus constructor inside a tagged set keeps its framing.
const items = CBOR.splitArrayItems(Bytes.fromHex("d9010281d8799f182aff"))
// items[0] is d8799f182aff, not d87981182a
```

Added in v2.8.0

## splitMapEntries

Split an encoded CBOR map into the ORIGINAL bytes of each of its keys and values.

The map counterpart of {@link splitArrayItems}, and the same argument applies: decoding a map
and re-encoding its entries runs each one through whatever options are in force, which for a
redeemer map's `plutus_data` moves `script_data_hash`.

Entries come back in wire order, which for a Plutus map is the order that matters.

**Signature**

```ts
export declare const splitMapEntries: (bytes: Uint8Array) => ReadonlyArray<readonly [Uint8Array, Uint8Array]>
```

Added in v2.8.0

# encoding

## compareByteKeys

Canonical CBOR map-key order for byte-string keys: shorter keys first, then lexicographic
(RFC 8949 §4.2.1, and CIP-21 for transaction bodies).

Ledger maps keyed by bytes -- multiassets, mints -- must be written in this order for a client
to reconstruct byte-identically the body a hardware wallet hashed in chunks. It is applied by
the encoders that own those maps rather than by a global codec option, because the same option
would also reorder Plutus map keys, which must keep the order they were given.

**Signature**

```ts
export declare const compareByteKeys: (a: Uint8Array, b: Uint8Array) => number
```

Added in v2.0.0

## encodeMapAsDefinite

Encode a CBOR definite-length map from already-encoded key and value bytes.

The sibling of `encodeArrayAsDefinite` for major type 5. Entries are written in the order
given — this is the raw-bytes path, so it imposes no key ordering of its own.

Together with the array and tag builders this is what lets a caller assemble a structure
around children it must NOT re-encode: anything already in bytes (a received datum, a script,
a redeemer) survives verbatim, where decoding it to a value and re-encoding can change its
framing and therefore its hash.

**Signature**

```ts
export declare const encodeMapAsDefinite: (entries: ReadonlyArray<readonly [Uint8Array, Uint8Array]>) => Uint8Array
```

Added in v2.0.0

## encodeTaggedSet

A `#6.258` set over items that are ALREADY encoded, written definite.

The write direction of {@link splitArrayItems}, and the shape every ledger set takes in Conway:
`inputs`, `certificates`, `collateral_inputs`, `required_signers`, `reference_inputs`, the
witness-set script fields and `plutus_data`. Babbage wrote a bare array and the ledger still
accepts it, so {@link encodeArrayAsDefinite} is the untagged form -- but the two are different
bytes and therefore a different transaction id, which is why neither is a default and a caller
says which it means.

⚠️ The items are spliced, not re-encoded, for the reason given on {@link splitArrayItems}.

**Signature**

```ts
export declare const encodeTaggedSet: (items: ReadonlyArray<Uint8Array>) => Uint8Array
```

Added in v2.8.0

## sortByteKeyedMap

Rebuild a byte-keyed map in canonical CBOR key order.

**Signature**

```ts
export declare const sortByteKeyedMap: <V>(map: Map<Uint8Array, V>) => Map<Uint8Array, V>
```

Added in v2.0.0

## toCBORBytes

Convert a CBOR value to CBOR bytes.

**Signature**

```ts
export declare const toCBORBytes: (value: CBOR, options?: CodecOptions) => Uint8Array
```

Added in v1.0.0

## toCBORBytesWithFormat

Convert a CBOR value to CBOR bytes using an explicit root format tree.

**Signature**

```ts
export declare const toCBORBytesWithFormat: (value: CBOR, format: CBORFormat) => Uint8Array
```

Added in v2.0.0

## toCBORHex

Convert a CBOR value to CBOR hex string.

**Signature**

```ts
export declare const toCBORHex: (value: CBOR, options?: CodecOptions) => string
```

Added in v1.0.0

## toCBORHexWithFormat

Convert a CBOR value to CBOR hex string using an explicit root format tree.

**Signature**

```ts
export declare const toCBORHexWithFormat: (value: CBOR, format: CBORFormat) => string
```

Added in v2.0.0

# equality

## equals

Schema-derived structural equivalence for CBOR values.
Handles Uint8Array, Array, Map, Tag and all primitives via the
recursive CBORSchema definition — no hand-rolled comparison needed.

Derived once at module init; at call time it's a plain function.

**Signature**

```ts
export declare const equals: (a: CBOR, b: CBOR) => boolean
```

Added in v2.0.0

# errors

## CBORError (class)

Error class for CBOR value operations

**Signature**

```ts
export declare class CBORError
```

Added in v1.0.0

# model

## BoundedBytes

`BoundedBytes` CBOR node — represents a PlutusData byte string that must comply
with the Conway CDDL constraint `bounded_bytes = bytes .size (0..64)`.

The encoding rule is unconditional and options-independent:

- ≤ 64 bytes → definite-length CBOR bytes
- > 64 bytes → indefinite-length 64-byte chunked byte string (`0x5f` + chunks + `0xff`)

Use `BoundedBytes.make` to construct the node; the encoder handles the rest.

**Signature**

```ts
export declare const BoundedBytes: {
  readonly make: (bytes: Uint8Array) => CBOR
  readonly is: (value: CBOR) => value is { _tag: "BoundedBytes"; bytes: Uint8Array }
}
```

Added in v2.0.0

## ByteSize (type alias)

Width of a CBOR integer argument: inline (0), 1-byte, 2-byte, 4-byte, or 8-byte.

**Signature**

```ts
export type ByteSize = 0 | 1 | 2 | 4 | 8
```

Added in v2.0.0

## CBOR (type alias)

Type representing a CBOR value with simplified, non-tagged structure

**Signature**

```ts
export type CBOR =
  | bigint // integers (both positive and negative)
  | Uint8Array // byte strings
  | string // text strings
  | ReadonlyArray<CBOR> // arrays
  | ReadonlyMap<CBOR, CBOR> // maps
  | { readonly [key: string | number]: CBOR } // record alternative to maps
  | { _tag: "Tag"; tag: number; value: CBOR } // tagged values
  | boolean // boolean values
  | null // null value
  | undefined // undefined value
  | number // floating point numbers
  | { _tag: "BoundedBytes"; bytes: Uint8Array } // PlutusData bounded byte strings (Conway CDDL bounded_bytes = bytes .size (0..64))
  | { _tag: "DefiniteArray"; items: ReadonlyArray<CBOR> } // an array written definite whatever the codec options say
  | { _tag: "Raw"; bytes: Uint8Array }
```

Added in v1.0.0

## CBORFormat (type alias)

Tagged discriminated union capturing how each CBOR node was originally
serialized. Every variant carries a `_tag` discriminant. Encoding-detail
fields are optional — absent means "use canonical / minimal default".

**Signature**

```ts
export type CBORFormat =
  | CBORFormat.UInt
  | CBORFormat.NInt
  | CBORFormat.Bytes
  | CBORFormat.Text
  | CBORFormat.Array
  | CBORFormat.Map
  | CBORFormat.Tag
  | CBORFormat.Simple
```

Added in v2.0.0

## CBORFormat (namespace)

Added in v2.0.0

### Array (type alias)

Array (major 4). `length` absent → definite, minimal length header.

**Signature**

```ts
export type Array = {
  readonly _tag: "array"
  readonly length?: LengthEncoding
  readonly children: ReadonlyArray<CBORFormat>
}
```

### Bytes (type alias)

Byte string (major 2). `encoding` absent → definite, minimal length.

**Signature**

```ts
export type Bytes = { readonly _tag: "bytes"; readonly encoding?: StringEncoding }
```

### Map (type alias)

Map (major 5). `keyOrder` stores CBOR-encoded key bytes for serializable ordering.

**Signature**

```ts
export type Map = {
  readonly _tag: "map"
  readonly length?: LengthEncoding
  readonly keyOrder?: ReadonlyArray<Uint8Array>
  readonly entries: ReadonlyArray<readonly [CBORFormat, CBORFormat]>
}
```

### NInt (type alias)

Negative integer (major 1). `byteSize` absent → minimal encoding.

**Signature**

```ts
export type NInt = { readonly _tag: "nint"; readonly byteSize?: ByteSize }
```

### Simple (type alias)

Simple value or float (major 7). No encoding choices to preserve.

**Signature**

```ts
export type Simple = { readonly _tag: "simple" }
```

### Tag (type alias)

Tag (major 6). `width` absent → minimal tag header.

**Signature**

```ts
export type Tag = {
  readonly _tag: "tag"
  readonly width?: ByteSize
  readonly child: CBORFormat
}
```

### Text (type alias)

Text string (major 3). `encoding` absent → definite, minimal length.

**Signature**

```ts
export type Text = { readonly _tag: "text"; readonly encoding?: StringEncoding }
```

### UInt (type alias)

Unsigned integer (major 0). `byteSize` absent → minimal encoding.

**Signature**

```ts
export type UInt = { readonly _tag: "uint"; readonly byteSize?: ByteSize }
```

## CodecOptions (type alias)

CBOR codec configuration options

**Signature**

```ts
export type CodecOptions =
  | {
      readonly mode: "canonical"
      readonly mapsAsObjects?: boolean
      /**
       * Encode every map as an array of `[key, value]` pairs.
       *
       * @deprecated This turns a map into a list, which is a different value
       * with a different hash. No Plutus data encoder writes maps this way, and
       * no option replaces it: leave it unset so maps stay maps.
       */
      readonly encodeMapAsPairs?: boolean
    }
  | {
      readonly mode: "custom"
      readonly useIndefiniteArrays: boolean
      readonly useIndefiniteMaps: boolean
      readonly useDefiniteForEmpty: boolean
      readonly sortMapKeys: boolean
      readonly useMinimalEncoding: boolean
      readonly mapsAsObjects?: boolean
      /**
       * Encode every map as an array of `[key, value]` pairs.
       *
       * @deprecated This turns a map into a list, which is a different value
       * with a different hash. No Plutus data encoder writes maps this way, and
       * no option replaces it: leave it unset so maps stay maps.
       */
      readonly encodeMapAsPairs?: boolean
    }
```

Added in v1.0.0

## DecodedWithFormat (type alias)

Decoded value paired with its captured root format tree.

**Signature**

```ts
export type DecodedWithFormat<A> = {
  value: A
  format: CBORFormat
}
```

Added in v2.0.0

## DefiniteArray

`DefiniteArray` CBOR node — an array written with definite-length framing whatever the codec
options say.

Its one consumer is the **tag-102 constructor wrapper** `[index, fields]`, which is definite
while the fields array inside it is indefinite. No single codec option can say both, and the
wrapper's framing is not a preference: `cardano-serialization-lib` 15.0.3 and
`cardano-multiplatform-lib` 6.2 both write `d866 82 …` for `Constr(999999, [42])`, where this
library wrote `d866 9f … ff`. Two independent implementations against one.

**Signature**

```ts
export declare const DefiniteArray: {
  readonly make: (items: ReadonlyArray<CBOR>) => CBOR
  readonly is: (value: CBOR) => value is { _tag: "DefiniteArray"; items: ReadonlyArray<CBOR> }
}
```

Added in v2.0.0

## LengthEncoding (type alias)

Container length encoding style captured during decode.

**Signature**

```ts
export type LengthEncoding = { readonly tag: "indefinite" } | { readonly tag: "definite"; readonly byteSize: ByteSize }
```

Added in v2.0.0

## Raw

`Raw` CBOR node — bytes that are already CBOR, written back unchanged.

Every other node describes a _value_ and leaves the encoder to choose a representation. This
one describes a representation. It exists because the ledger hashes the bytes a value arrived
as, not a fresh encoding of it, and several of those choices are not recoverable from the
decoded value: an empty indefinite array (`9fff`) decodes to the same `[]` as `80`, a
chunked byte string to the same bytes as an unchunked one, a non-minimal integer header to the
same number. Re-deriving any of them changes the hash, and for `plutus_data` inside a redeemer
that changes `script_data_hash` and the transaction is rejected with nothing pointing back here.

`Data.plutusDataToCBORValue` emits one of these for any node whose arrival bytes were recorded
on the {@link OriginalBytes} channel, so the single encoder below handles provenance and
structure in one pass instead of a caller splicing bytes by hand.

⚠️ The bytes are not validated. A `Raw` holding something that is not well-formed CBOR produces
a transaction that is not well-formed CBOR. Build it only from bytes a decoder returned.

**Signature**

```ts
export declare const Raw: {
  readonly make: (bytes: Uint8Array) => CBOR
  readonly is: (value: CBOR) => value is { _tag: "Raw"; bytes: Uint8Array }
}
```

Added in v2.8.0

## StringEncoding (type alias)

Byte/text string encoding style captured during decode.

**Signature**

```ts
export type StringEncoding =
  | { readonly tag: "definite"; readonly byteSize: ByteSize }
  | {
      readonly tag: "indefinite"
      readonly chunks: ReadonlyArray<{ readonly length: number; readonly byteSize: ByteSize }>
    }
```

Added in v2.0.0

## TxCodecOptions (type alias)

CBOR options for a transaction and the structures in it.

- `ledger`: the options for ledger structures: the body, the witness set,
  and the containers that hold datums and redeemers.
- `plutusData`: the options for Plutus data items: new inline datums,
  witness datums and redeemer data.

**Signature**

```ts
export type TxCodecOptions = {
  readonly ledger: CodecOptions
  readonly plutusData: CodecOptions
}
```

Added in v2.0.0

# parsing

## fromCBORBytes

Parse a CBOR value from CBOR bytes.

**Signature**

```ts
export declare const fromCBORBytes: (bytes: Uint8Array, options?: CodecOptions) => CBOR
```

Added in v1.0.0

## fromCBORBytesWithFormat

Parse a CBOR value from CBOR bytes and return the root format tree.

**Signature**

```ts
export declare const fromCBORBytesWithFormat: (bytes: Uint8Array) => DecodedWithFormat<CBOR>
```

Added in v2.0.0

## fromCBORHex

Parse a CBOR value from CBOR hex string.

**Signature**

```ts
export declare const fromCBORHex: (hex: string, options?: CodecOptions) => CBOR
```

Added in v1.0.0

## fromCBORHexWithFormat

Parse a CBOR value from CBOR hex string and return the root format tree.

**Signature**

```ts
export declare const fromCBORHexWithFormat: (hex: string) => DecodedWithFormat<CBOR>
```

Added in v2.0.0

## internalDecodeWithFormatSync

Decode CBOR bytes and return both the decoded value and the root format tree.

**Signature**

```ts
export declare const internalDecodeWithFormatSync: (data: Uint8Array) => DecodedWithFormat<CBOR>
```

Added in v2.0.0

# schemas

## CBORSchema

CBOR Value discriminated union schema representing all possible CBOR data types
Inspired by OCaml and Rust CBOR implementations

**Signature**

```ts
export declare const CBORSchema: Schema.Schema<CBOR, CBOR, never>
```

Added in v1.0.0

## FromBytes

Create a CBOR bytes schema with custom codec options

**Signature**

```ts
export declare const FromBytes: (
  options: CodecOptions
) => Schema.transformOrFail<typeof Schema.Uint8ArrayFromSelf, Schema.declare<CBOR, CBOR, readonly [], never>, never>
```

Added in v1.0.0

## Integer

CBOR Value schema definitions for each major type

**Signature**

```ts
export declare const Integer: typeof Schema.BigIntFromSelf
```

Added in v1.0.0

# transformation

## match

Pattern matching utility for CBOR values

**Signature**

```ts
export declare const match: <R>(
  value: CBOR,
  patterns: {
    integer: (value: bigint) => R
    bytes: (value: Uint8Array) => R
    text: (value: string) => R
    array: (value: ReadonlyArray<CBOR>) => R
    map: (value: ReadonlyMap<CBOR, CBOR>) => R
    record: (value: { readonly [key: string]: CBOR }) => R
    tag: (tag: number, value: CBOR) => R
    boolean: (value: boolean) => R
    null: () => R
    undefined: () => R
    float: (value: number) => R
    boundedBytes: (value: Uint8Array) => R
  }
) => R
```

Added in v1.0.0

## toTxCodecOptions

Turns plain options into transaction options: `ledger` is the options and
`plutusData` is the options too, except that {@link CML_DEFAULT_OPTIONS}
gives {@link PLUTUS_DATA_OPTIONS}, as {@link TX_DEFAULT_OPTIONS} does.
Transaction options are returned as they are.

**Signature**

```ts
export declare const toTxCodecOptions: (options: TxCodecOptions | CodecOptions) => TxCodecOptions
```

Added in v2.0.0

# utils

## ArraySchema

**Signature**

```ts
export declare const ArraySchema: Schema.Array$<Schema.suspend<CBOR, CBOR, never>>
```

## ByteArray

**Signature**

```ts
export declare const ByteArray: typeof Schema.Uint8ArrayFromSelf
```

## Either (namespace)

## Float

**Signature**

```ts
export declare const Float: typeof Schema.Number
```

## FromHex

**Signature**

```ts
export declare const FromHex: (
  options: CodecOptions
) => Schema.transform<
  Schema.Schema<Uint8Array, string, never>,
  Schema.transformOrFail<typeof Schema.Uint8ArrayFromSelf, Schema.declare<CBOR, CBOR, readonly [], never>, never>
>
```

## MapSchema

**Signature**

```ts
export declare const MapSchema: Schema.ReadonlyMapFromSelf<
  Schema.suspend<CBOR, CBOR, never>,
  Schema.suspend<CBOR, CBOR, never>
>
```

## RecordSchema

**Signature**

```ts
export declare const RecordSchema: Schema.Record$<typeof Schema.String, Schema.suspend<CBOR, CBOR, never>>
```

## Simple

**Signature**

```ts
export declare const Simple: Schema.Union<[typeof Schema.Boolean, typeof Schema.Null, typeof Schema.Undefined]>
```

## Tag

**Signature**

```ts
export declare const Tag: Schema.TaggedStruct<
  "Tag",
  { tag: typeof Schema.Number; value: Schema.suspend<CBOR, CBOR, never> }
>
```

## Text

**Signature**

```ts
export declare const Text: typeof Schema.String
```

## encodeArrayAsDefinite

Encode a CBOR definite-length array from already-encoded item bytes.
This is a low-level function that constructs: definite_array_header + items.

**Signature**

```ts
export declare const encodeArrayAsDefinite: (items: ReadonlyArray<Uint8Array>) => Uint8Array
```

## encodeArrayAsIndefinite

Encode a CBOR indefinite-length array from already-encoded item bytes.
This is a low-level function that constructs: 0x9f + items + 0xff.

**Signature**

```ts
export declare const encodeArrayAsIndefinite: (items: ReadonlyArray<Uint8Array>) => Uint8Array
```

## encodeTaggedValue

Encode a CBOR tagged value from already-encoded value bytes.
This is a low-level function that constructs: tag_header + value_bytes.

**Signature**

```ts
export declare const encodeTaggedValue: (tag: number, valueBytes: Uint8Array) => Uint8Array
```

## internalDecodeSync

**Signature**

```ts
export declare const internalDecodeSync: (data: Uint8Array, options?: CodecOptions) => CBOR
```

## internalEncodeSync

**Signature**

```ts
export declare const internalEncodeSync: (value: CBOR, options?: CodecOptions, fmt?: CBORFormat) => Uint8Array
```

## isArray

**Signature**

```ts
export declare const isArray: (u: unknown, overrideOptions?: ParseOptions | number) => u is readonly CBOR[]
```

## isByteArray

**Signature**

```ts
export declare const isByteArray: (u: unknown, overrideOptions?: ParseOptions | number) => u is any
```

## isInteger

**Signature**

```ts
export declare const isInteger: (u: unknown, overrideOptions?: ParseOptions | number) => u is bigint
```

## isMap

**Signature**

```ts
export declare const isMap: (u: unknown, overrideOptions?: ParseOptions | number) => u is ReadonlyMap<CBOR, CBOR>
```

## isRecord

**Signature**

```ts
export declare const isRecord: (
  u: unknown,
  overrideOptions?: ParseOptions | number
) => u is { readonly [x: string]: CBOR }
```

## isTag

**Signature**

```ts
export declare const isTag: (
  u: unknown,
  overrideOptions?: ParseOptions | number
) => u is { readonly _tag: "Tag"; readonly tag: number; readonly value: CBOR }
```

## map

**Signature**

```ts
export declare const map: <K extends CBOR, V extends CBOR>(
  key: Schema.Schema<K>,
  value: Schema.Schema<V>
) => Schema.ReadonlyMapFromSelf<Schema.Schema<K, K, never>, Schema.Schema<V, V, never>>
```

## tag

**Signature**

```ts
export declare const tag: <T extends number, C extends Schema.Schema<any, any>>(
  tag: T,
  value: C
) => Schema.TaggedStruct<"Tag", { tag: Schema.Literal<[T]>; value: C }>
```
