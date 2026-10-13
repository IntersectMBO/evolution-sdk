---

title: Bip32PublicKey.ts
nav_order: 13
parent: Modules
---

## Bip32PublicKey overview

---

<h2 class="text-delta">Table of contents</h2>

- [accessors](#accessors)
  - [chainCode](#chaincode)
  - [publicKey](#publickey)
- [arbitrary](#arbitrary)
  - [arbitrary](#arbitrary-1)
- [derivation](#derivation)
  - [deriveChild](#derivechild)
  - [derivePath](#derivepath)
- [either](#either)
  - [Either (namespace)](#either-namespace)
- [encoding](#encoding)
  - [toBytes](#tobytes)
  - [toHex](#tohex)
  - [toRawBytes](#torawbytes)
- [errors](#errors)
  - [Bip32PublicKeyError (class)](#bip32publickeyerror-class)
- [model](#model)
  - [Hex (type alias)](#hex-type-alias)
- [parsing](#parsing)
  - [fromBytes](#frombytes)
- [schemas](#schemas)
  - [Bip32PublicKey (class)](#bip32publickey-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
  - [FromBytes](#frombytes-1)
  - [FromHex](#fromhex)
  - [Hex](#hex)
- [utils](#utils)
  - [fromHex](#fromhex-1)

---

# accessors

## chainCode

Get the chain code.

**Signature**

```ts
export declare const chainCode: (bip32PublicKey: Bip32PublicKey) => Uint8Array
```

Added in v2.0.0

## publicKey

Get the public key bytes.

**Signature**

```ts
export declare const publicKey: (bip32PublicKey: Bip32PublicKey) => Uint8Array
```

Added in v2.0.0

# arbitrary

## arbitrary

FastCheck arbitrary for generating random Bip32PublicKey instances.

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<Bip32PublicKey>
```

Added in v2.0.0

# derivation

## deriveChild

Derive a child public key using the specified index (soft derivation only).

**Signature**

```ts
export declare const deriveChild: (bip32PublicKey: Bip32PublicKey, index: number) => Bip32PublicKey
```

Added in v2.0.0

## derivePath

Derive a child public key down a path of indices (soft derivation only).

This is what lets a wallet derive addresses from a co-signer's account xpub — no seed, no
signing ceremony — which is the whole basis of a shared wallet.

⚠️ **Throws on any hardened index.** `deriveChild` takes a plain `number`, so a caller who
passes `0x80000000 + n` by habit (every private-side path is written that way) would otherwise
get a key silently derived from the wrong index. The account level and above are hardened by
construction, so the mistake is an easy one; failing loudly is the only safe answer.

**Signature**

```ts
export declare const derivePath: (bip32PublicKey: Bip32PublicKey, indices: ReadonlyArray<number>) => Bip32PublicKey
```

Added in v2.0.0

# either

## Either (namespace)

Either-based error handling variants for functions that can fail.

Added in v2.0.0

# encoding

## toBytes

Convert a Bip32PublicKey to raw bytes (64 bytes).

**Signature**

```ts
export declare const toBytes: (a: Bip32PublicKey, overrideOptions?: ParseOptions) => Uint8Array
```

Added in v2.0.0

## toHex

Convert a Bip32PublicKey to hex string.

**Signature**

```ts
export declare const toHex: (value: Parameters<typeof encodeHex>[0]) => Hex
```

Added in v2.0.0

## toRawBytes

Convert a Bip32PublicKey to raw public key bytes (32 bytes only).

**Signature**

```ts
export declare const toRawBytes: (bip32PublicKey: Bip32PublicKey) => Uint8Array
```

Added in v2.0.0

# errors

## Bip32PublicKeyError (class)

Error class for Bip32PublicKey related operations.

**Signature**

```ts
export declare class Bip32PublicKeyError
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

Create a BIP32 public key from public key and chain code bytes.

**Signature**

```ts
export declare const fromBytes: (i: Uint8Array, overrideOptions?: ParseOptions) => Bip32PublicKey
```

Added in v2.0.0

# schemas

## Bip32PublicKey (class)

Schema for Bip32PublicKey representing a BIP32-Ed25519 extended public key.
Always 64 bytes: 32-byte public key + 32-byte chaincode.
Follows BIP32-Ed25519 hierarchical deterministic key derivation.
Supports soft derivation only (hardened derivation requires private key).

**Signature**

```ts
export declare class Bip32PublicKey
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

Schema for transforming between Uint8Array and Bip32PublicKey.

**Signature**

```ts
export declare const FromBytes: Schema.transform<
  Schema.SchemaClass<Uint8Array, Uint8Array, never>,
  Schema.SchemaClass<Bip32PublicKey, Bip32PublicKey, never>
>
```

Added in v2.0.0

## FromHex

Schema for transforming between hex string and Bip32PublicKey.

**Signature**

```ts
export declare const FromHex: Schema.transform<
  Schema.filter<Schema.Schema<Uint8Array, string, never>>,
  Schema.transform<
    Schema.SchemaClass<Uint8Array, Uint8Array, never>,
    Schema.SchemaClass<Bip32PublicKey, Bip32PublicKey, never>
  >
>
```

Added in v2.0.0

## Hex

A BIP32-Ed25519 extended PUBLIC key as hex (64 bytes: 32-byte key + 32-byte chain code).

Validated as well as branded: a 64-byte lowercase or uppercase hex string. {@link toHex}
returns this type, so the kind of a hex string survives leaving the typed domain — upstream of
this, every hash and key was an unmarked `string` once encoded.

⚠️ Branded apart from {@link Bip32PrivateKey.Hex} deliberately. The two are the same shape and
confusing them is unrecoverable in one direction: publishing where a private key was expected is
merely wrong, while signing with what you believed was public is a leaked key.

**Signature**

```ts
export declare const Hex: Schema.brand<Schema.filter<typeof Schema.String>, "Bip32PublicKeyHex">
```

Added in v2.4.0

# utils

## fromHex

**Signature**

```ts
export declare const fromHex: (i: string, overrideOptions?: ParseOptions) => Bip32PublicKey
```
