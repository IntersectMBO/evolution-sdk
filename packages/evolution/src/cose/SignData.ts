/**
 * High-level CIP-30 wallet API for message signing and verification.
 *
 * Implements the DataSignature format used by Cardano wallets.
 *
 * @since 2.0.0
 * @category Sign Data
 */

import { blake2b } from "@noble/hashes/blake2.js"
import { Equal, Schema } from "effect"

import * as Address from "../Address.js"
import * as Bytes from "../Bytes.js"
import type * as CBOR from "../CBOR.js"
import * as Credential from "../Credential.js"
import type * as Ed25519Signature from "../Ed25519Signature.js"
import * as KeyHash from "../KeyHash.js"
import * as PrivateKey from "../PrivateKey.js"
import * as RewardAccount from "../RewardAccount.js"
import * as VKey from "../VKey.js"
import { headerMapNew, headersNew } from "./Header.js"
import { COSEKeyFromCBORBytes, EdDSA25519Key, publicKey as coseKeyPublicKey } from "./Key.js"
import { AlgorithmId, labelFromInt, labelFromText } from "./Label.js"
import { coseSign1BuilderNew, COSESign1FromCBORBytes } from "./Sign1.js"
import type { Payload } from "./Utils.js"

// ============================================================================
// Types
// ============================================================================

/**
 * Signed message result (CIP-30 DataSignature format).
 *
 * Contains CBOR-encoded COSE_Sign1 (signature) and COSE_Key (public key).
 *
 * @since 2.0.0
 * @category Types
 */
export type SignedMessage = {
  readonly signature: Uint8Array
  readonly key: Uint8Array
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Sign data with a private key using COSE_Sign1.
 *
 * Implements CIP-30 `api.signData()` specification. Creates a COSE_Sign1 structure with:
 * - Protected headers: algorithm (EdDSA), address
 * - Unprotected headers: hashed (false)
 * - Payload: NOT pre-hashed
 * - Returns CBOR-encoded COSE_Sign1 and COSE_Key
 *
 * @since 2.0.0
 * @category API
 */
export const signData = (
  addressHex: string,
  payload: Payload,
  privateKey: PrivateKey.PrivateKey,
  options?: {
    /**
     * Put the signing public key in the protected headers as `kid` (label 4).
     *
     * CIP-8 leaves this optional and CIP-30 wallets differ, but a verifier that only has the
     * COSE_Sign1 — no COSE_Key alongside it — cannot recover the key without it, so several
     * services require it. Off by default: adding it changes the signed bytes.
     */
    readonly includeKeyId?: boolean
  }
): SignedMessage => {
  // Create headers with algorithm and address in protected headers
  let protectedHeaders = headerMapNew().setAlgorithmId(AlgorithmId.EdDSA)
  if (options?.includeKeyId === true) {
    // Between `alg` and `address`: the protected header is serialized in insertion order, and
    // these bytes are what gets signed.
    protectedHeaders = protectedHeaders.setHeader(labelFromInt(4n), VKey.fromPrivateKey(privateKey).bytes)
  }
  protectedHeaders = protectedHeaders.setHeader(labelFromText("address"), Bytes.fromHex(addressHex))
  // Add "hashed": false to unprotected headers
  const unprotectedHeaders = headerMapNew().setHeader(labelFromText("hashed"), false)
  const headers = headersNew(protectedHeaders, unprotectedHeaders)

  // Create builder
  const builder = coseSign1BuilderNew(headers, payload, false)

  // Create data to sign
  const dataToSign = builder.makeDataToSign()

  // Sign with private key
  const signature = PrivateKey.sign(privateKey, dataToSign)

  // Build COSESign1
  const coseSign1 = builder.build(signature)

  // Encode to CBOR bytes
  const signedBytes = Schema.encodeSync(COSESign1FromCBORBytes())(coseSign1)

  // Build COSEKey
  const vkey = VKey.fromPrivateKey(privateKey)
  const ed25519Key = new EdDSA25519Key({ privateKey: undefined, publicKey: vkey }, { disableValidation: true })
  const coseKey = ed25519Key.build()
  const keyBytes = Schema.encodeSync(COSEKeyFromCBORBytes())(coseKey)

  return {
    signature: signedBytes,
    key: keyBytes
  }
}

/**
 * Assemble a COSE_Sign1 and COSE_Key from an EXTERNALLY produced signature.
 *
 * The hardware-wallet path. `signData` needs a `PrivateKey`, which a device never surrenders:
 * the device is handed the `Sig_structure`, signs it internally and returns only the signature,
 * so the bytes around it have to be assembled here. Without this a wallet backed by a Ledger or
 * Trezor cannot serve CIP-30 `signData` at all.
 *
 * The caller is responsible for the signature matching what this assembles. The protected
 * headers must be byte-identical to the ones the device signed over, which is why:
 *
 * - `addressHex` is the `"address"` protected header the device embedded. Device firmware sends
 *   either the full address or the key hash depending on its mode, and it is passed through
 *   verbatim rather than re-derived. Omit it only if the device omitted it.
 * - No `kid` header is written. Device firmware does not include one, and adding it here would
 *   change the signed bytes and invalidate the signature.
 * - `hashed` must mirror the request made to the device. When true, the payload is
 *   blake2b-224-hashed here exactly as the firmware hashed it before signing, and the CIP-8
 *   `hashed` flag is set so a verifier re-derives the same `Sig_structure`.
 *
 * @since 2.0.0
 * @category API
 */
export const assembleSignData = (
  addressHex: string | undefined,
  payload: Payload,
  options: {
    /** Mirror of the `hashed` flag the device signed under. */
    readonly hashed: boolean
    /** The public key whose private half produced `signature`. */
    readonly publicKey: VKey.VKey
    /** The Ed25519 signature the device returned. */
    readonly signature: Ed25519Signature.Ed25519Signature
  }
): SignedMessage => {
  let protectedHeaders = headerMapNew().setAlgorithmId(AlgorithmId.EdDSA)
  if (addressHex !== undefined) {
    protectedHeaders = protectedHeaders.setHeader(labelFromText("address"), Bytes.fromHex(addressHex))
  }
  const unprotectedHeaders = headerMapNew().setHeader(labelFromText("hashed"), options.hashed)
  const headers = headersNew(protectedHeaders, unprotectedHeaders)

  const signedPayload = options.hashed ? blake2b(payload, { dkLen: 28 }) : payload
  const coseSign1 = coseSign1BuilderNew(headers, signedPayload, false).build(options.signature)
  const signedBytes = Schema.encodeSync(COSESign1FromCBORBytes())(coseSign1)

  const ed25519Key = new EdDSA25519Key({ privateKey: undefined, publicKey: options.publicKey }, {
    disableValidation: true
  })
  const keyBytes = Schema.encodeSync(COSEKeyFromCBORBytes())(ed25519Key.build())

  return { signature: signedBytes, key: keyBytes }
}

/**
 * Resolve the key-hash credential that a claimed address commits to. The
 * signing key must hash to this credential for the signature to be bound to the
 * address. Per CIP-19, reward (stake) addresses use header types `0b1110` and
 * `0b1111` and carry a stake credential; base and enterprise addresses carry a
 * payment credential. Returns undefined when the address cannot be parsed.
 *
 * Exported because it is the rule, not a detail: any CIP-8 consumer deciding whether a key may
 * speak for an address needs exactly this, and a consumer that reimplements it will get a reward
 * address wrong — those are bound by their STAKE credential, not a payment one.
 *
 * @since 2.3.0
 * @category Accessors
 */
export const addressSignerCredential = (addressHex: string): Credential.Credential | undefined => {
  const header = Bytes.fromHex(addressHex)[0]
  if (header === undefined) return undefined
  const addressType = header >> 4
  const isRewardAddress = addressType === 0b1110 || addressType === 0b1111
  if (isRewardAddress) {
    try {
      return RewardAccount.fromHex(addressHex).stakeCredential
    } catch {
      return undefined
    }
  }
  return Address.getPaymentCredential(addressHex)
}

/**
 * Verify a signed message ON ITS OWN TERMS: CIP-8 P2 always, and P1 whenever the protected header
 * claims an address.
 *
 * ⚠️ **Different from {@link verifyData}, and both are needed.** `verifyData` is handed the
 * address, the key hash and the payload SEPARATELY, by a caller that already knows which address
 * it wants proof for -- that is the shape an authentication check wants. This one is handed only
 * the message, which is the shape a wallet has when answering "is this signature valid?" and the
 * shape a CIP-30 `signData` round trip is tested in. Feeding `verifyData` values extracted from
 * the message would make its own checks tautological, and for a CIP-8 `hashed` message it would
 * compare blake2b(payload) against payload and wrongly return false.
 *
 * ⚠️ **NOT an authentication primitive.** CIP-8 splits verification into P1 (relate the key to a
 * Cardano address, OPTIONAL) and P2 (the signature). A message carrying no address claim verifies
 * here while proving control of nothing, so anything that GRANTS ACCESS wants {@link verifyData}
 * with the address it actually cares about.
 *
 * What it does check, when a claim is present:
 * - a claim that cannot be read as bytes FAILS CLOSED, or a malformed header becomes the way to
 *   skip P1 while a lenient consumer still displays the victim's address;
 * - the 28-byte form is compared against the signing key's hash, and the full-address form against
 *   that address's own credential. A software wallet embeds the address; a hardware KEY_HASH
 *   envelope embeds only the credential, and requiring the first rejects every device signature;
 * - a script credential is never satisfiable by one Ed25519 key, in either form.
 *
 * Malformed input is "does not verify", never a throw: these bytes come from a counterparty.
 *
 * @since 2.8.0
 * @category API
 */
export const verifyMessage = (signedMessage: SignedMessage): boolean => {
  try {
    const coseSign1 = Schema.decodeSync(COSESign1FromCBORBytes())(signedMessage.signature)
    const coseKey = Schema.decodeSync(COSEKeyFromCBORBytes())(signedMessage.key)
    const publicKey = coseKeyPublicKey(coseKey)
    if (publicKey === undefined) return false

    const addressLabel = labelFromText("address")
    let claimed: CBOR.CBOR | undefined
    for (const [label, value] of coseSign1.headers.protected.headers.entries()) {
      if (Equal.equals(label, addressLabel)) {
        claimed = value
        break
      }
    }

    if (claimed !== undefined) {
      if (!(claimed instanceof Uint8Array)) return false
      const keyHashHex = KeyHash.toHex(KeyHash.fromVKey(publicKey))
      if (claimed.length === 28) {
        if (Bytes.toHex(claimed) !== keyHashHex) return false
      } else {
        const credential = addressSignerCredential(Bytes.toHex(claimed))
        if (credential === undefined || credential._tag !== "KeyHash") return false
        if (Credential.toHex(credential) !== keyHashHex) return false
      }
    }

    return VKey.verify(publicKey, coseSign1.signedData(), coseSign1.signature.bytes)
  } catch {
    return false
  }
}

/**
 * Verify a COSE_Sign1 signed message.
 *
 * Validates CIP-30 signatures by verifying:
 * - Payload matches signed data (honoring the CIP-8 `hashed` flag: when set, the
 *   signed payload is the blake2b-224 digest of the message)
 * - Address matches protected headers
 * - Algorithm is EdDSA
 * - Public key hash matches provided key hash
 * - Public key hashes to the claimed address's credential (address binding):
 *   the payment credential for base/enterprise addresses, the stake credential
 *   for reward addresses
 * - Ed25519 signature is cryptographically valid
 *
 * The address-binding check prevents accepting a signature produced by one key
 * while a different victim address is presented in the protected header. Only
 * key-hash credentials are accepted; script addresses cannot be proven by a
 * single Ed25519 key and are rejected.
 *
 * @since 2.0.0
 * @category API
 */
export const verifyData = (
  addressHex: string,
  keyHash: string,
  payload: Payload,
  signedMessage: SignedMessage
): boolean => {
  try {
    // Decode COSESign1 from signature bytes
    const coseSign1 = Schema.decodeSync(COSESign1FromCBORBytes())(signedMessage.signature)

    // Verify payload matches (allow empty payloads)
    if (coseSign1.payload === undefined) return false
    // Honor the CIP-8 "hashed" flag. cardano-message-signing writes it to the
    // unprotected headers and, when set, signs the blake2b-224 digest of the
    // message rather than the message itself. Match that so hashed messages from
    // CIP-30 wallets verify against the original payload.
    const hashedLabel = labelFromText("hashed")
    let payloadHashed = false
    for (const [label, value] of coseSign1.headers.unprotected.headers.entries()) {
      if (Equal.equals(label, hashedLabel)) {
        payloadHashed = value === true
        break
      }
    }
    const expectedPayload = payloadHashed ? blake2b(payload, { dkLen: 28 }) : payload
    if (!Bytes.equals(coseSign1.payload, expectedPayload)) return false

    // Get protected headers
    const addressLabel = labelFromText("address")
    let addressInSignature: CBOR.CBOR | undefined
    for (const [label, value] of coseSign1.headers.protected.headers.entries()) {
      if (Equal.equals(label, addressLabel)) {
        addressInSignature = value
        break
      }
    }
    if (addressInSignature === undefined) return false
    if (!(addressInSignature instanceof Uint8Array)) return false

    // The credential `addressHex` commits to. Resolved here because the claim below may be
    // expressed as that credential rather than as the address, and the key binding at the end
    // needs the same value.
    const expectedCredential = addressSignerCredential(addressHex)
    if (expectedCredential === undefined || expectedCredential._tag !== "KeyHash") return false
    const expectedCredentialHex = Credential.toHex(expectedCredential)

    // ⚠️ **Two claim forms are valid, and accepting only the first rejects every hardware
    // signature.** A CIP-30 software wallet embeds the full address bytes in the protected
    // `"address"` header; a hardware wallet's KEY_HASH envelope embeds only the 28-byte credential
    // the signing key hashes to — Ledger and Trezor both do, and `assembleSignData` above builds
    // exactly that shape. Requiring the full address made those unverifiable.
    //
    // The credential form adds no latitude: it is compared against the credential of the address
    // the CALLER named, and the key binding below independently requires the signing key to hash
    // to that same credential. A script credential never reaches here, so a key cannot speak for
    // a script address in either form.
    const claimedHex = Bytes.toHex(addressInSignature)
    if (claimedHex !== addressHex && claimedHex !== expectedCredentialHex) return false

    // Get algorithm ID from protected headers
    const algorithmId = coseSign1.headers.protected.algorithmId()
    if (algorithmId === undefined) return false
    if (algorithmId !== AlgorithmId.EdDSA) return false

    // Decode COSEKey and extract public key
    const coseKey = Schema.decodeSync(COSEKeyFromCBORBytes())(signedMessage.key)

    // Extract public key from COSEKey headers (parameter -2)
    const publicKey = coseKeyPublicKey(coseKey)
    if (publicKey === undefined) return false
    const publicKeyHash = KeyHash.fromVKey(publicKey)
    const publicKeyHashHex = KeyHash.toHex(publicKeyHash)
    if (publicKeyHashHex !== keyHash) return false

    // Bind the signing key to the claimed address: the embedded public key must
    // hash to the address's credential. Without this, a signature made by an
    // attacker key carrying a victim address in its protected header would
    // verify. Script credentials cannot be satisfied by one Ed25519 key.
    if (expectedCredentialHex !== publicKeyHashHex) return false

    // Get signed data
    const signedData = coseSign1.signedData()

    // Verify signature
    return VKey.verify(publicKey, signedData, coseSign1.signature.bytes)
  } catch {
    return false
  }
}
