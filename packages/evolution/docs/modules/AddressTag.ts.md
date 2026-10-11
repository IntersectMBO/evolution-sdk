---

title: AddressTag.ts
nav_order: 3
parent: Modules
---

## AddressTag overview

Address header kind - used to determine the type of address from its header
Following CIP-0019 address types

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [transformation](#transformation)
  - [fromBytes](#frombytes)
  - [fromHeader](#fromheader)
  - [networkId](#networkid)
  - [paymentCredential](#paymentcredential)
  - [stakeCredential](#stakecredential)
- [utils](#utils)
  - [AddressTag (type alias)](#addresstag-type-alias)

---

# transformation

## fromBytes

The address kind these bytes declare, or `undefined` when they are empty or carry an undefined
header kind.

**Signature**

```ts
export declare const fromBytes: (bytes: Uint8Array) => AddressTag | undefined
```

Added in v2.0.0

## fromHeader

The address kind a header byte declares, or `undefined` for one CIP-19 does not define
(`1001`-`1101`, reserved for future formats).

**Signature**

```ts
export declare const fromHeader: (header: number) => AddressTag | undefined
```

Added in v2.0.0

## networkId

The network id in the header's low nibble (CIP-19 bits 3-0), or `undefined` for empty bytes.

⚠️ Byron addresses carry no network nibble — the low bits are part of the CBOR, not a network —
so this answers `undefined` for them rather than a number that means nothing.

**Signature**

```ts
export declare const networkId: (bytes: Uint8Array) => number | undefined
```

Added in v2.0.0

## paymentCredential

The payment credential, for the kinds that carry one (base, pointer, enterprise). `undefined`
for a reward or Byron address, and for bytes too short to hold it.

**Signature**

```ts
export declare const paymentCredential: (bytes: Uint8Array) => Credential.Credential | undefined
```

Added in v2.0.0

## stakeCredential

The staking credential, for the kinds that carry one: a base address holds it after the payment
credential, a reward address directly after the header. `undefined` for every other kind, and
for bytes too short to hold it.

**Signature**

```ts
export declare const stakeCredential: (bytes: Uint8Array) => Credential.Credential | undefined
```

Added in v2.0.0

# utils

## AddressTag (type alias)

**Signature**

```ts
export type AddressTag = "Base" | "Enterprise" | "Pointer" | "Reward" | "Byron"
```
