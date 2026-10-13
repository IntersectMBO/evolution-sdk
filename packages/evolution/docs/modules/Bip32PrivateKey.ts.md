---

title: Bip32PrivateKey.ts
nav_order: 12
parent: Modules
---

## Bip32PrivateKey overview

---

<h2 class="text-delta">Table of contents</h2>

- [bip32](#bip32)
  - [derive](#derive)
  - [deriveChild](#derivechild)
  - [derivePath](#derivepath)
- [bip39](#bip39)
  - [fromBip39Entropy](#frombip39entropy)
- [cml-compatibility](#cml-compatibility)
  - [from128XPRV](#from128xprv)
  - [to128XPRV](#to128xprv)
- [constants](#constants)
  - [PURPOSE_CIP1852](#purpose_cip1852)
  - [PURPOSE_CIP1854](#purpose_cip1854)
- [conversion](#conversion)
  - [toPrivateKey](#toprivatekey)
- [cryptography](#cryptography)
  - [toPublicKey](#topublickey)
- [encoding](#encoding)
  - [toBytes](#tobytes)
  - [toHex](#tohex)
- [errors](#errors)
  - [Bip32PrivateKeyError (class)](#bip32privatekeyerror-class)
- [model](#model)
  - [Hex (type alias)](#hex-type-alias)
- [parsing](#parsing)
  - [fromBytes](#frombytes)
- [schemas](#schemas)
  - [Bip32PrivateKey (class)](#bip32privatekey-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex)
  - [Hex](#hex)
- [utils](#utils)
  - [CardanoPath](#cardanopath)
  - [Either (namespace)](#either-namespace)
  - [arbitrary](#arbitrary)
  - [fromHex](#fromhex-1)

---

# bip32

## derive

Derive a child private key using multiple indices.

**Signature**

```ts
export declare const derive: (bip32PrivateKey: Bip32PrivateKey, indices: Array<number>) => Bip32PrivateKey
```

Added in v2.0.0

## deriveChild

Derive a child private key using a single derivation index (V2 scheme).
Supports hardened (index >= 0x80000000) and soft derivation.

**Signature**

```ts
export declare const deriveChild: (bip32PrivateKey: Bip32PrivateKey, index: number) => Bip32PrivateKey
```

Added in v2.0.0

## derivePath

Derive a child private key using a BIP32 path string.
Supports paths like "m/1852'/1815'/0'/0/0" or "1852'/1815'/0'/0/0".

**Signature**

```ts
export declare const derivePath: (bip32PrivateKey: Bip32PrivateKey, path: string) => Bip32PrivateKey
```

Added in v2.0.0

# bip39

## fromBip39Entropy

Create a Bip32PrivateKey from BIP39 entropy with PBKDF2 key stretching.

**Signature**

```ts
export declare const fromBip39Entropy: (entropy: Uint8Array, password?: Uint8Array | string) => Bip32PrivateKey
```

Added in v2.0.0

# cml-compatibility

## from128XPRV

Create from CML-compatible 128-byte format.

**Signature**

```ts
export declare const from128XPRV: (bytes: Uint8Array) => Bip32PrivateKey
```

Added in v2.0.0

## to128XPRV

Serialize to CML-compatible 128-byte format: [scalar(32) | iv(32) | publicKey(32) | chainCode(32)].

**Signature**

```ts
export declare const to128XPRV: (bip32PrivateKey: Bip32PrivateKey) => Uint8Array
```

Added in v2.0.0

# constants

## PURPOSE_CIP1852

CIP-1852, the ordinary wallet purpose.

**Signature**

```ts
export declare const PURPOSE_CIP1852: 1852
```

Added in v2.0.0

## PURPOSE_CIP1854

CIP-1854, the multi-signature purpose: same shape, different keys, never interchangeable.

**Signature**

```ts
export declare const PURPOSE_CIP1854: 1854
```

Added in v2.0.0

# conversion

## toPrivateKey

Convert to standard (non-extended) PrivateKey (first 64 bytes: scalar + IV).

**Signature**

```ts
export declare const toPrivateKey: (bip32PrivateKey: Bip32PrivateKey) => PrivateKey.PrivateKey
```

Added in v2.0.0

# cryptography

## toPublicKey

Derive the corresponding Bip32PublicKey.

**Signature**

```ts
export declare const toPublicKey: (bip32PrivateKey: Bip32PrivateKey) => Bip32PublicKey.Bip32PublicKey
```

Added in v2.0.0

# encoding

## toBytes

Convert a Bip32PrivateKey to raw bytes.

**Signature**

```ts
export declare const toBytes: (a: Bip32PrivateKey, overrideOptions?: ParseOptions) => Uint8Array
```

Added in v2.0.0

## toHex

Convert a Bip32PrivateKey to hex string.

**Signature**

```ts
export declare const toHex: (value: Parameters<typeof encodeHex>[0]) => Hex
```

Added in v2.0.0

# errors

## Bip32PrivateKeyError (class)

Error class for Bip32PrivateKey related operations.

**Signature**

```ts
export declare class Bip32PrivateKeyError
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

Parse a Bip32PrivateKey from raw bytes.

**Signature**

```ts
export declare const fromBytes: (i: Uint8Array, overrideOptions?: ParseOptions) => Bip32PrivateKey
```

Added in v2.0.0

# schemas

## Bip32PrivateKey (class)

Schema for Bip32PrivateKey representing a BIP32-Ed25519 extended private key.
Always 96 bytes: 32-byte scalar + 32-byte IV + 32-byte chain code.
Derivation implements the V2 scheme for CML compatibility.

**Signature**

```ts
export declare class Bip32PrivateKey
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

## FromBytes

Schema for transforming between Uint8Array and Bip32PrivateKey.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<Bip32PrivateKey, Bip32PrivateKey, never>
>
```

Added in v2.0.0

## FromHex

Schema for transforming between hex string and Bip32PrivateKey.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<
    Schema.SchemaClass<Uint8Array, Uint8Array, never>,
    Schema.SchemaClass<Bip32PrivateKey, Bip32PrivateKey, never>
  >
>
```

Added in v2.0.0

## Hex

A BIP32-Ed25519 extended PRIVATE key as hex (96 bytes: scalar, IV and chain code).

Validated as well as branded: a 96-byte lowercase or uppercase hex string. {@link toHex}
returns this type, so the kind of a hex string survives leaving the typed domain — upstream of
this, every hash and key was an unmarked `string` once encoded.

⚠️ See {@link Bip32PublicKey.Hex} for why these two carry different brands.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "Bip32PrivateKeyHex">
```

Added in v2.4.0

# utils

## CardanoPath

**Signature**

```ts
export declare const CardanoPath: {
  harden: (n: number) => number
  indices: (account?: number, role?: number, index?: number, purpose?: number) => Array<number>
  paymentIndices: (account?: number, index?: number) => Array<number>
  stakeIndices: (account?: number, index?: number) => Array<number>
  drepIndices: (account?: number, index?: number) => Array<number>
  multisigPaymentIndices: (account?: number, index?: number) => Array<number>
  multisigStakeIndices: (account?: number, index?: number) => Array<number>
}
```

## Either (namespace)

## arbitrary

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<Bip32PrivateKey>
```

## fromHex

**Signature**

```ts
export declare const fromHex: (i: string, overrideOptions?: ParseOptions) => Bip32PrivateKey
```
