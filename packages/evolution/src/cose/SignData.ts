/**
 * High-level CIP-30 wallet API for message signing and verification.
 *
 * Implements the DataSignature format used by Cardano wallets.
 *
 * @since 2.0.0
 * @category Sign Data
 */

import { Equal, Schema } from "effect"

import * as Address from "../Address.js"
import * as Bytes from "../Bytes.js"
import type * as CBOR from "../CBOR.js"
import * as Credential from "../Credential.js"
import * as KeyHash from "../KeyHash.js"
import * as PrivateKey from "../PrivateKey.js"
import * as RewardAccount from "../RewardAccount.js"
import * as VKey from "../VKey.js"
import { headerMapNew, headersNew } from "./Header.js"
import { COSEKeyFromCBORBytes, EdDSA25519Key } from "./Key.js"
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
export const signData = (addressHex: string, payload: Payload, privateKey: PrivateKey.PrivateKey): SignedMessage => {
  // Create headers with algorithm and address in protected headers
  const protectedHeaders = headerMapNew()
    .setAlgorithmId(AlgorithmId.EdDSA)
    .setHeader(labelFromText("address"), Bytes.fromHex(addressHex))
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
 * Resolve the key-hash credential that a claimed address commits to. The
 * signing key must hash to this credential for the signature to be bound to the
 * address. Per CIP-19, reward (stake) addresses use header types `0b1110` and
 * `0b1111` and carry a stake credential; base and enterprise addresses carry a
 * payment credential. Returns undefined when the address cannot be parsed.
 */
const addressSignerCredential = (addressHex: string): Credential.Credential | undefined => {
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
 * Verify a COSE_Sign1 signed message.
 *
 * Validates CIP-30 signatures by verifying:
 * - Payload matches signed data
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
    if (!Bytes.equals(coseSign1.payload, payload)) return false

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
    if (Bytes.toHex(addressInSignature) !== addressHex) return false

    // Get algorithm ID from protected headers
    const algorithmId = coseSign1.headers.protected.algorithmId()
    if (algorithmId === undefined) return false
    if (algorithmId !== AlgorithmId.EdDSA) return false

    // Decode COSEKey and extract public key
    const coseKey = Schema.decodeSync(COSEKeyFromCBORBytes())(signedMessage.key)

    // Extract public key from COSEKey headers (parameter -2)
    const pubKeyLabel = labelFromInt(-2n)
    let publicKeyBytes: Uint8Array | undefined
    for (const [label, value] of coseKey.headers.headers.entries()) {
      if (Equal.equals(label, pubKeyLabel)) {
        publicKeyBytes = value as Uint8Array
        break
      }
    }
    if (publicKeyBytes === undefined) return false

    const publicKey = VKey.fromBytes(publicKeyBytes)
    const publicKeyHash = KeyHash.fromVKey(publicKey)
    const publicKeyHashHex = KeyHash.toHex(publicKeyHash)
    if (publicKeyHashHex !== keyHash) return false

    // Bind the signing key to the claimed address: the embedded public key must
    // hash to the address's credential. Without this, a signature made by an
    // attacker key carrying a victim address in its protected header would
    // verify. Script credentials cannot be satisfied by one Ed25519 key.
    const expectedCredential = addressSignerCredential(addressHex)
    if (expectedCredential === undefined || expectedCredential._tag !== "KeyHash") return false
    if (Credential.toHex(expectedCredential) !== publicKeyHashHex) return false

    // Get signed data
    const signedData = coseSign1.signedData()

    // Verify signature
    return VKey.verify(publicKey, signedData, coseSign1.signature.bytes)
  } catch {
    return false
  }
}
