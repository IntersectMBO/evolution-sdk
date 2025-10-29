---
title: sdk/Credential.ts
nav_order: 145
parent: Modules
---

## Credential overview

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [Credential (type alias)](#credential-type-alias)
  - [KeyHash (type alias)](#keyhash-type-alias)
  - [ScriptHash (type alias)](#scripthash-type-alias)
  - [fromCredentialToJson](#fromcredentialtojson)
  - [jsonToCredential](#jsontocredential)

---

# utils

## Credential (type alias)

**Signature**

```ts
export type Credential = typeof _Credential.CredentialSchema.Encoded
```

## KeyHash (type alias)

**Signature**

```ts
export type KeyHash = typeof _KeyHash.KeyHash.Encoded
```

## ScriptHash (type alias)

**Signature**

```ts
export type ScriptHash = typeof _ScriptHash.ScriptHash.Encoded
```

## fromCredentialToJson

**Signature**

```ts
export declare const fromCredentialToJson: (
  a: _KeyHash.KeyHash | _ScriptHash.ScriptHash,
  overrideOptions?: ParseOptions
) => { readonly _tag: "KeyHash"; readonly hash: string } | { readonly _tag: "ScriptHash"; readonly hash: string }
```

## jsonToCredential

**Signature**

```ts
export declare const jsonToCredential: (
  i: { readonly _tag: "KeyHash"; readonly hash: string } | { readonly _tag: "ScriptHash"; readonly hash: string },
  overrideOptions?: ParseOptions
) => _KeyHash.KeyHash | _ScriptHash.ScriptHash
```
