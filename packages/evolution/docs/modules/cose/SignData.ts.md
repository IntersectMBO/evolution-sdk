---

title: cose/SignData.ts
nav_order: 47
parent: Modules
---

## SignData overview

High-level CIP-30 wallet API for message signing and verification.

Implements the DataSignature format used by Cardano wallets.

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [API](#api)
  - [assembleSignData](#assemblesigndata)
  - [signData](#signdata)
  - [verifyData](#verifydata)
  - [verifyMessage](#verifymessage)
- [Accessors](#accessors)
  - [addressSignerCredential](#addresssignercredential)
- [Types](#types)
  - [SignedMessage (type alias)](#signedmessage-type-alias)

---

# API

## assembleSignData

Assemble a COSE_Sign1 and COSE_Key from an EXTERNALLY produced signature.

The hardware-wallet path. `signData` needs a `PrivateKey`, which a device never surrenders:
the device is handed the `Sig_structure`, signs it internally and returns only the signature,
so the bytes around it have to be assembled here. Without this a wallet backed by a Ledger or
Trezor cannot serve CIP-30 `signData` at all.

The caller is responsible for the signature matching what this assembles. The protected
headers must be byte-identical to the ones the device signed over, which is why:

- `addressHex` is the `"address"` protected header the device embedded. Device firmware sends
  either the full address or the key hash depending on its mode, and it is passed through
  verbatim rather than re-derived. Omit it only if the device omitted it.
- No `kid` header is written. Device firmware does not include one, and adding it here would
  change the signed bytes and invalidate the signature.
- `hashed` must mirror the request made to the device. When true, the payload is
  blake2b-224-hashed here exactly as the firmware hashed it before signing, and the CIP-8
  `hashed` flag is set so a verifier re-derives the same `Sig_structure`.

**Signature**

```ts
export declare const assembleSignData: (
  addressHex: string | undefined,
  payload: Payload,
  options: {
    readonly hashed: boolean
    readonly publicKey: VKey.VKey
    readonly signature: Ed25519Signature.Ed25519Signature
  }
) => SignedMessage
```

Added in v2.0.0

## signData

Sign data with a private key using COSE_Sign1.

Implements CIP-30 `api.signData()` specification. Creates a COSE_Sign1 structure with:

- Protected headers: algorithm (EdDSA), address
- Unprotected headers: hashed (false)
- Payload: NOT pre-hashed
- Returns CBOR-encoded COSE_Sign1 and COSE_Key

**Signature**

```ts
export declare const signData: (
  addressHex: string,
  payload: Payload,
  privateKey: PrivateKey.PrivateKey,
  options?: { readonly includeKeyId?: boolean }
) => SignedMessage
```

Added in v2.0.0

## verifyData

Verify a COSE_Sign1 signed message.

Validates CIP-30 signatures by verifying:

- Payload matches signed data (honoring the CIP-8 `hashed` flag: when set, the
  signed payload is the blake2b-224 digest of the message)
- Address matches protected headers
- Algorithm is EdDSA
- Public key hash matches provided key hash
- Public key hashes to the claimed address's credential (address binding):
  the payment credential for base/enterprise addresses, the stake credential
  for reward addresses
- Ed25519 signature is cryptographically valid

The address-binding check prevents accepting a signature produced by one key
while a different victim address is presented in the protected header. Only
key-hash credentials are accepted; script addresses cannot be proven by a
single Ed25519 key and are rejected.

**Signature**

```ts
export declare const verifyData: (
  addressHex: string,
  keyHash: string,
  payload: Payload,
  signedMessage: SignedMessage
) => boolean
```

Added in v2.0.0

## verifyMessage

Verify a signed message ON ITS OWN TERMS: CIP-8 P2 always, and P1 whenever the protected header
claims an address.

⚠️ **Different from {@link verifyData}, and both are needed.** `verifyData` is handed the
address, the key hash and the payload SEPARATELY, by a caller that already knows which address
it wants proof for -- that is the shape an authentication check wants. This one is handed only
the message, which is the shape a wallet has when answering "is this signature valid?" and the
shape a CIP-30 `signData` round trip is tested in. Feeding `verifyData` values extracted from
the message would make its own checks tautological, and for a CIP-8 `hashed` message it would
compare blake2b(payload) against payload and wrongly return false.

⚠️ **NOT an authentication primitive.** CIP-8 splits verification into P1 (relate the key to a
Cardano address, OPTIONAL) and P2 (the signature). A message carrying no address claim verifies
here while proving control of nothing, so anything that GRANTS ACCESS wants {@link verifyData}
with the address it actually cares about.

What it does check, when a claim is present:

- a claim that cannot be read as bytes FAILS CLOSED, or a malformed header becomes the way to
  skip P1 while a lenient consumer still displays the victim's address;
- the 28-byte form is compared against the signing key's hash, and the full-address form against
  that address's own credential. A software wallet embeds the address; a hardware KEY_HASH
  envelope embeds only the credential, and requiring the first rejects every device signature;
- a script credential is never satisfiable by one Ed25519 key, in either form.

Malformed input is "does not verify", never a throw: these bytes come from a counterparty.

**Signature**

```ts
export declare const verifyMessage: (signedMessage: SignedMessage) => boolean
```

Added in v2.8.0

# Accessors

## addressSignerCredential

Resolve the key-hash credential that a claimed address commits to. The
signing key must hash to this credential for the signature to be bound to the
address. Per CIP-19, reward (stake) addresses use header types `0b1110` and
`0b1111` and carry a stake credential; base and enterprise addresses carry a
payment credential. Returns undefined when the address cannot be parsed.

Exported because it is the rule, not a detail: any CIP-8 consumer deciding whether a key may
speak for an address needs exactly this, and a consumer that reimplements it will get a reward
address wrong — those are bound by their STAKE credential, not a payment one.

**Signature**

```ts
export declare const addressSignerCredential: (addressHex: string) => Credential.Credential | undefined
```

Added in v2.3.0

# Types

## SignedMessage (type alias)

Signed message result (CIP-30 DataSignature format).

Contains CBOR-encoded COSE_Sign1 (signature) and COSE_Key (public key).

**Signature**

```ts
export type SignedMessage = {
  readonly signature: Uint8Array
  readonly key: Uint8Array
}
```

Added in v2.0.0
