/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import * as M from "@emurgo/cardano-message-signing-nodejs"
import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import { fromHex, toHex } from "../src/Bytes.js"
import { SignData } from "../src/cose/index.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"

function signData(addressHex: string, payload: string, privateKey: string): { signature: string; key: string } {
  const protectedHeaders = M.HeaderMap.new()
  protectedHeaders.set_algorithm_id(M.Label.from_algorithm_id(M.AlgorithmId.EdDSA))
  protectedHeaders.set_header(M.Label.new_text("address"), M.CBORValue.new_bytes(fromHex(addressHex)))
  const protectedSerialized = M.ProtectedHeaderMap.new(protectedHeaders)
  const unprotectedHeaders = M.HeaderMap.new()
  const headers = M.Headers.new(protectedSerialized, unprotectedHeaders)
  const builder = M.COSESign1Builder.new(headers, fromHex(payload), false)
  const toSign = builder.make_data_to_sign().to_bytes()

  const priv = CML.PrivateKey.from_bech32(privateKey)

  const signedSigStruc = priv.sign(toSign).to_raw_bytes()
  const coseSign1 = builder.build(signedSigStruc)

  const key = M.COSEKey.new(M.Label.from_key_type(M.KeyType.OKP))
  key.set_algorithm_id(M.Label.from_algorithm_id(M.AlgorithmId.EdDSA))
  key.set_header(M.Label.new_int(M.Int.new_negative(M.BigNum.from_str("1"))), M.CBORValue.new_int(M.Int.new_i32(6)))
  key.set_header(
    M.Label.new_int(M.Int.new_negative(M.BigNum.from_str("2"))),
    M.CBORValue.new_bytes(priv.to_public().to_raw_bytes())
  )

  return {
    signature: toHex(coseSign1.to_bytes()),
    key: toHex(key.to_bytes())
  }
}

export function verifyData(
  addressHex: string,
  keyHash: string,
  payload: string,
  signedMessage: { signature: string; key: string }
): boolean {
  const cose1 = M.COSESign1.from_bytes(fromHex(signedMessage.signature))
  const key = M.COSEKey.from_bytes(fromHex(signedMessage.key))

  const protectedHeaders = cose1.headers().protected().deserialized_headers()

  const cose1Address = (() => {
    try {
      return toHex(protectedHeaders.header(M.Label.new_text("address"))?.as_bytes()!)
    } catch (cause) {
      throw new Error("No address found in signature.", { cause })
    }
  })()

  const cose1AlgorithmId = (() => {
    try {
      const int = protectedHeaders.algorithm_id()?.as_int()
      if (int?.is_positive()) return parseInt(int.as_positive()?.to_str()!)
      return parseInt(int?.as_negative()?.to_str()!)
    } catch (cause) {
      throw new Error("Failed to retrieve Algorithm Id.", { cause })
    }
  })()

  const keyAlgorithmId = (() => {
    try {
      const int = key.algorithm_id()?.as_int()
      if (int?.is_positive()) return parseInt(int.as_positive()?.to_str()!)
      return parseInt(int?.as_negative()?.to_str()!)
    } catch (cause) {
      throw new Error("Failed to retrieve Algorithm Id.", { cause })
    }
  })()

  const keyCurve = (() => {
    try {
      const int = key.header(M.Label.new_int(M.Int.new_negative(M.BigNum.from_str("1"))))?.as_int()
      if (int?.is_positive()) return parseInt(int.as_positive()?.to_str()!)
      return parseInt(int?.as_negative()?.to_str()!)
    } catch (cause) {
      throw new Error("Failed to retrieve Curve.", { cause })
    }
  })()

  const keyType = (() => {
    try {
      const int = key.key_type().as_int()
      if (int?.is_positive()) return parseInt(int.as_positive()?.to_str()!)
      return parseInt(int?.as_negative()?.to_str()!)
    } catch (cause) {
      throw new Error("Failed to retrieve Key Type.", { cause })
    }
  })()

  const publicKey = (() => {
    try {
      return CML.PublicKey.from_bytes(
        key.header(M.Label.new_int(M.Int.new_negative(M.BigNum.from_str("2"))))?.as_bytes()!
      )
    } catch (cause) {
      throw new Error("No public key found.", { cause })
    }
  })()

  const cose1Payload = (() => {
    try {
      return toHex(cose1.payload()!)
    } catch (cause) {
      throw new Error("No payload found.", { cause })
    }
  })()

  const signature = CML.Ed25519Signature.from_raw_bytes(cose1.signature())

  const data = cose1.signed_data(undefined, undefined).to_bytes()

  if (cose1Address !== addressHex) return false

  if (keyHash !== publicKey.hash().to_hex()) return false

  if (cose1AlgorithmId !== keyAlgorithmId && cose1AlgorithmId !== M.AlgorithmId.EdDSA) {
    return false
  }

  if (keyCurve !== 6) return false

  if (keyType !== 1) return false

  if (cose1Payload !== payload) return false

  return publicKey.verify(data, signature)
}

describe("SignData Parity with lucid-evolution", () => {
  const privateKey = PrivateKey.fromBytes(PrivateKey.generate())
  const privateKeyBech32 = PrivateKey.toBech32(privateKey)
  const publicKey = PrivateKey.toPublicKey(privateKey)
  const keyHash = KeyHash.fromVKey(publicKey)
  const keyHashHex = KeyHash.toHex(keyHash)
  // Real enterprise address bound to the signer's key hash (verifyData enforces
  // that the signing key matches the address's payment credential).
  const addressHex = Address.toHex(new Address.Address({ networkId: 0, paymentCredential: keyHash }))
  const payload = new Uint8Array([1, 2, 3, 4, 5])
  const payloadHex = toHex(payload)

  it("should verify cross-compatibility: our sign → lucid verify", () => {
    const ourSigned = SignData.signData(addressHex, payload, privateKey)

    const lucidFormat = {
      signature: toHex(ourSigned.signature),
      key: toHex(ourSigned.key)
    }

    const verified = verifyData(addressHex, keyHashHex, payloadHex, lucidFormat)
    expect(verified).toBe(true)
  })

  it("should verify cross-compatibility: lucid sign → our verify", () => {
    const lucidSigned = signData(addressHex, payloadHex, privateKeyBech32)

    const ourFormat = {
      signature: fromHex(lucidSigned.signature),
      key: fromHex(lucidSigned.key)
    }

    const verified = SignData.verifyData(addressHex, keyHashHex, payload, ourFormat)
    expect(verified).toBe(true)
  })

  it("should produce identical outputs: our impl === lucid impl", () => {
    const ourSigned = SignData.signData(addressHex, payload, privateKey)
    const lucidSigned = signData(addressHex, payloadHex, privateKeyBech32)

    const ourSignatureHex = toHex(ourSigned.signature)
    const ourKeyHex = toHex(ourSigned.key)

    expect(ourSignatureHex).toBe(lucidSigned.signature)
    expect(ourKeyHex).toBe(lucidSigned.key)
  })

  it("should handle large payloads: both implementations", () => {
    const largePayload = new Uint8Array(1000).fill(42)
    const largePayloadHex = toHex(largePayload)

    const ourSigned = SignData.signData(addressHex, largePayload, privateKey)
    const lucidSigned = signData(addressHex, largePayloadHex, privateKeyBech32)

    const ourFormat = {
      signature: fromHex(lucidSigned.signature),
      key: fromHex(lucidSigned.key)
    }
    expect(SignData.verifyData(addressHex, keyHashHex, largePayload, ourFormat)).toBe(true)

    const lucidFormat = {
      signature: toHex(ourSigned.signature),
      key: toHex(ourSigned.key)
    }
    expect(verifyData(addressHex, keyHashHex, largePayloadHex, lucidFormat)).toBe(true)
  })

  it("should fail verification with wrong payload: both implementations", () => {
    const payload1 = new Uint8Array([1, 2, 3])
    const payload2 = new Uint8Array([4, 5, 6])
    const payload1Hex = toHex(payload1)
    const payload2Hex = toHex(payload2)

    const ourSigned = SignData.signData(addressHex, payload1, privateKey)
    const lucidSigned = signData(addressHex, payload1Hex, privateKeyBech32)

    const ourFormat = {
      signature: fromHex(lucidSigned.signature),
      key: fromHex(lucidSigned.key)
    }
    expect(SignData.verifyData(addressHex, keyHashHex, payload2, ourFormat)).toBe(false)

    const lucidFormat = {
      signature: toHex(ourSigned.signature),
      key: toHex(ourSigned.key)
    }
    expect(verifyData(addressHex, keyHashHex, payload2Hex, lucidFormat)).toBe(false)
  })

  it("should fail verification with wrong address: both implementations", () => {
    const wrongKeyHash = "0000000000000000000000000000000000000000000000000000000000000000"

    const ourSigned = SignData.signData(addressHex, payload, privateKey)
    const lucidSigned = signData(addressHex, payloadHex, privateKeyBech32)

    const ourFormat = {
      signature: fromHex(lucidSigned.signature),
      key: fromHex(lucidSigned.key)
    }
    expect(SignData.verifyData(wrongKeyHash, keyHashHex, payload, ourFormat)).toBe(false)

    const lucidFormat = {
      signature: toHex(ourSigned.signature),
      key: toHex(ourSigned.key)
    }
    expect(verifyData(wrongKeyHash, keyHashHex, payloadHex, lucidFormat)).toBe(false)
  })

  it("verifies a hashed message produced by cardano-message-signing", () => {
    const message = new TextEncoder().encode("a long message that a wallet chooses to hash before signing")

    // Build a hashed COSE_Sign1 with the reference library: hash_payload sets the
    // hashed flag in the unprotected headers and signs blake2b-224 of the message.
    const protectedHeaders = M.HeaderMap.new()
    protectedHeaders.set_algorithm_id(M.Label.from_algorithm_id(M.AlgorithmId.EdDSA))
    protectedHeaders.set_header(M.Label.new_text("address"), M.CBORValue.new_bytes(fromHex(addressHex)))
    const headers = M.Headers.new(M.ProtectedHeaderMap.new(protectedHeaders), M.HeaderMap.new())
    const builder = M.COSESign1Builder.new(headers, message, false)
    builder.hash_payload()
    const toSign = builder.make_data_to_sign().to_bytes()
    const priv = CML.PrivateKey.from_bech32(privateKeyBech32)
    const coseSign1 = builder.build(priv.sign(toSign).to_raw_bytes())

    const key = M.COSEKey.new(M.Label.from_key_type(M.KeyType.OKP))
    key.set_algorithm_id(M.Label.from_algorithm_id(M.AlgorithmId.EdDSA))
    key.set_header(M.Label.new_int(M.Int.new_negative(M.BigNum.from_str("1"))), M.CBORValue.new_int(M.Int.new_i32(6)))
    key.set_header(
      M.Label.new_int(M.Int.new_negative(M.BigNum.from_str("2"))),
      M.CBORValue.new_bytes(priv.to_public().to_raw_bytes())
    )

    const ourFormat = { key: key.to_bytes(), signature: coseSign1.to_bytes() }

    // verifyData honors the hashed flag and verifies against the original message
    expect(SignData.verifyData(addressHex, keyHashHex, message, ourFormat)).toBe(true)
    // a different preimage must fail
    expect(SignData.verifyData(addressHex, keyHashHex, new TextEncoder().encode("different message"), ourFormat)).toBe(
      false
    )
  })
})
