/**
 * CIP-8 / CIP-30 address-bound verification, and the envelope around an external signature.
 *
 * Here rather than beside the key-holding tiers because neither of these needs a key, and
 * therefore neither needs a codec service — the same reason `Inspect` lives here. That matters to
 * the callers: the consumer of `verifyDataForAddress` is typically a SERVER deciding whether to
 * authenticate a request, and requiring it to build a codec layer would pull a wallet's whole byte
 * surface into something that only ever reads.
 *
 * ⚠️ **{@link verifyDataForAddress} is the authentication primitive.** CIP-8 splits verification
 * into P1 (relate the key to a Cardano address, optional) and P2 (the signature). A verifier that
 * does P2 alone, or does P1 only against the address the message chose for itself, accepts a
 * cryptographically perfect signature by a foreign key over a victim's address. Use this whenever
 * the result grants access to anything.
 *
 * The plain P2-with-optional-P1 verification belongs in a codec seam, where a second backend can
 * be held against it byte for byte. Only the two operations that need no key live here.
 *
 * @since 0.1.0
 */

import { Credential, Ed25519Signature, KeyHash, VKey } from "@evolution-sdk/evolution"
import * as COSE from "@evolution-sdk/evolution/cose"
import { Effect, Equal, Schema } from "effect"

import type { AddressHex, KeyHashHex } from "./Brands.js"
import { CborError } from "./Errors.js"

/**
 * The address a COSE `address` claim may carry: a full Cardano address, or the 28-byte key-hash
 * credential a hardware device's KEY_HASH envelope embeds instead.
 *
 * @since 0.1.0
 */
export type CoseAddressHeader = AddressHex | KeyHashHex

/**
 * The CIP-30 `DataSignature`: the COSE_Sign1 and the COSE_Key that verifies it, both as hex.
 *
 * @since 0.1.0
 */
export interface DataSignature {
  readonly signature: string
  readonly key: string
}

const hex = (b: Uint8Array): string => {
  let out = ""
  for (const byte of b) out += byte.toString(16).padStart(2, "0")
  return out
}

const bytes = (h: string): Uint8Array => {
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error(`invalid hex: ${h.slice(0, 32)}…`)
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

const CREDENTIAL_LEN = 28
const ADDRESS_LABEL = COSE.Label.labelFromText("address")

/** The Ed25519 public key a COSE_Key carries, or undefined when it carries none. */
const publicKeyOf = (keyHex: string): Uint8Array | undefined => {
  const coseKey = Schema.decodeSync(COSE.COSEKey.COSEKeyFromCBORBytes())(bytes(keyHex))
  // COSE key parameter -2 is the Ed25519 public key. ⚠️ Match on `label.value`, a bigint:
  // `label.kind` is a numeric enum, and only its `toJSON` renders it as "Int".
  for (const [label, value] of coseKey.headers.headers.entries()) {
    if (typeof label.value === "bigint" && label.value === -2n) {
      return value instanceof Uint8Array ? value : undefined
    }
  }
  return undefined
}

/**
 * The protected header's `address` claim, in three states that must stay distinct. An ABSENT claim
 * is legitimate — CIP-8 P1 is optional — while a MALFORMED one is an attack surface: conflating
 * them lets a crafted header skip the ownership check while a lenient consumer still reads a
 * victim's address out of it.
 */
type AddressClaim =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed" }
  | { readonly kind: "present"; readonly hex: string }

const addressClaim = (sign1: COSE.COSESign1.COSESign1): AddressClaim => {
  for (const [label, value] of sign1.headers.protected.headers.entries()) {
    if (Equal.equals(label, ADDRESS_LABEL)) {
      return value instanceof Uint8Array ? { kind: "present", hex: hex(value) } : { kind: "malformed" }
    }
  }
  return { kind: "absent" }
}

/** The key-hash credential an address-shaped hex commits to, or undefined when it has none. */
const keyCredentialOf = (addressHex: string): string | undefined => {
  const cred = COSE.SignData.addressSignerCredential(addressHex)
  // A script credential is never satisfiable by one Ed25519 key.
  return cred !== undefined && cred._tag === "KeyHash" ? Credential.toHex(cred) : undefined
}

/**
 * Is `publicKey` the key that `addressOrCredentialHex` commits to? Both forms are accepted, and
 * accepting only the first would reject every hardware signature: a software wallet embeds the
 * full address, a device's KEY_HASH envelope embeds only the credential the key hashes to.
 */
const keyBoundTo = (addressOrCredentialHex: string, publicKey: Uint8Array): boolean => {
  const keyHashHex = KeyHash.toHex(KeyHash.fromVKey(VKey.fromBytes(publicKey)))
  if (bytes(addressOrCredentialHex).length === CREDENTIAL_LEN) return addressOrCredentialHex === keyHashHex
  return keyCredentialOf(addressOrCredentialHex) === keyHashHex
}

/** Does an `address` claim designate `expectedHex` — the same bytes, or its key credential? */
const claimDesignates = (claimHex: string, expectedHex: string): boolean => {
  if (claimHex === expectedHex) return true
  if (bytes(claimHex).length !== CREDENTIAL_LEN) return false
  return keyCredentialOf(expectedHex) === claimHex
}

/**
 * Verify a COSE_Sign1 as a PROOF THAT THE SIGNER CONTROLS `addressHex` — CIP-8 P1 mandatory.
 *
 * Requires all of:
 *  1. the protected header carries an `address` claim (a MISSING claim fails here, where in a
 *     plain P2 verification it merely skips P1 — "no claim" proves control of nothing);
 *  2. that claim designates `addressHex`, as the same bytes or as its 28-byte key credential;
 *  3. the key owns `addressHex` — checked against what the CALLER passed, never against what the
 *     message claims, so a message cannot authenticate itself by merely agreeing with itself;
 *  4. the signature verifies, honouring the CIP-8 `hashed` flag.
 *
 * Returns `false` for malformed input rather than failing: these bytes come from a counterparty.
 *
 * @since 0.1.0
 * @category verification
 */
export const verifyDataForAddress = (
  sig: DataSignature,
  addressHex: CoseAddressHeader
): Effect.Effect<boolean, CborError> =>
  Effect.try({
    try: () => {
      try {
        const sign1 = COSE.COSESign1.coseSign1FromCBORHex(sig.signature)
        const publicKey = publicKeyOf(sig.key)
        if (publicKey === undefined) return false

        const claim = addressClaim(sign1)
        if (claim.kind !== "present") return false
        if (!claimDesignates(claim.hex, addressHex)) return false
        // Redundant on paper given the line above, and kept because it is the one that states the
        // actual rule: a later change to what "designates" accepts cannot quietly widen who may
        // speak for an address.
        if (!keyBoundTo(addressHex, publicKey)) return false

        return VKey.verify(VKey.fromBytes(publicKey), sign1.signedData(), sign1.signature.bytes)
      } catch {
        return false
      }
    },
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

/**
 * Wrap an EXTERNALLY produced signature (a device's `signMessage`) in the CIP-30 pair.
 *
 * `addressHex` is the protected `address` header the device embedded: the full address in ADDRESS
 * mode, the signing key hash in KEY_HASH mode, `undefined` when it embedded neither. `hashed` must
 * mirror the request the device signed under — the flag changes the signed bytes, so a mismatch
 * fails verification for a reason that points nowhere near the flag.
 *
 * @since 0.1.0
 * @category signing
 */
export const assembleData = (
  addressHex: CoseAddressHeader | undefined,
  payloadHex: string,
  hashed: boolean,
  pubkeyHex: string,
  signatureHex: string
): Effect.Effect<DataSignature, CborError> =>
  Effect.try({
    try: () => {
      const out = COSE.SignData.assembleSignData(addressHex, bytes(payloadHex), {
        hashed,
        publicKey: VKey.fromBytes(bytes(pubkeyHex)),
        signature: Ed25519Signature.fromBytes(bytes(signatureHex))
      })
      return { signature: hex(out.signature), key: hex(out.key) } satisfies DataSignature
    },
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })
