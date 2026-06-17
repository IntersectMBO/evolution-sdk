import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import { COSESign1, Header, SignData, Utils } from "../src/cose/index.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as VKey from "../src/VKey.js"

describe("SignData", () => {
  describe("Payload", () => {
    it("should create a Payload from hex string", () => {
      const payload = Utils.fromHex("48656c6c6f")
      expect(payload).toBeInstanceOf(Uint8Array)
      expect(Utils.toHex(payload)).toBe("48656c6c6f")
    })

    it("should convert text to payload and back", () => {
      const originalText = "Hello, Cardano!"
      const payload = Utils.fromText(originalText)
      const decodedText = Utils.toText(payload)
      expect(decodedText).toBe(originalText)
    })
  })

  describe("signData and verifyData", () => {
    it("should sign and verify a simple message", () => {
      // Generate a private key
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)

      // Create a test address (using the public key hash)
      const addressHex = Bytes.toHex(keyHash.hash)

      // Create payload
      const payload = Utils.fromText("Hello, Cardano!")

      // Sign the data
      const signedMessage = SignData.signData(addressHex, payload, privateKey)

      // Verify it
      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, signedMessage)
      expect(isValid).toBe(true)
    })

    it("should fail verification with wrong payload", () => {
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex = KeyHash.toHex(keyHash)

      const payload1 = Utils.fromText("Hello")
      const payload2 = Utils.fromText("World")

      const signedMessage = SignData.signData(addressHex, payload1, privateKey)
      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload2, signedMessage)

      expect(isValid).toBe(false)
    })

    it("should fail verification with wrong address", () => {
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex1 = KeyHash.toHex(keyHash)
      const addressHex2 = "ff" + KeyHash.toHex(keyHash).slice(2)

      const payload = Utils.fromText("Hello")

      const signedMessage = SignData.signData(addressHex1, payload, privateKey)
      const isValid = SignData.verifyData(addressHex2, KeyHash.toHex(keyHash), payload, signedMessage)

      expect(isValid).toBe(false)
    })

    it("should fail verification with wrong key hash", () => {
      const privateKeyBytes1 = PrivateKey.generate()
      const privateKeyBytes2 = PrivateKey.generate()

      const privateKey1 = PrivateKey.fromBytes(privateKeyBytes1)
      const privateKey2 = PrivateKey.fromBytes(privateKeyBytes2)

      const keyHash1 = KeyHash.fromPrivateKey(privateKey1)
      const keyHash2 = KeyHash.fromPrivateKey(privateKey2)

      const addressHex = KeyHash.toHex(keyHash1)
      const payload = Utils.fromText("Hello")

      const signedMessage = SignData.signData(addressHex, payload, privateKey1)
      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash2), payload, signedMessage)

      expect(isValid).toBe(false)
    })

    it("should handle empty payloads", () => {
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex = KeyHash.toHex(keyHash)

      const payload = new Uint8Array(0) as Utils.Payload

      const signedMessage = SignData.signData(addressHex, payload, privateKey)
      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, signedMessage)

      expect(isValid).toBe(true)
    })

    it("should handle large payloads", () => {
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex = KeyHash.toHex(keyHash)

      // Create a large payload (1KB of data)
      const largeText = "x".repeat(1024)
      const payload = Utils.fromText(largeText)

      const signedMessage = SignData.signData(addressHex, payload, privateKey)
      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, signedMessage)

      expect(isValid).toBe(true)
    })

    it("should work with extended private keys (64 bytes)", () => {
      const extendedKey = PrivateKey.generateExtended()
      const privateKey = PrivateKey.fromBytes(extendedKey)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex = KeyHash.toHex(keyHash)

      const payload = Utils.fromText("Testing extended keys")

      const signedMessage = SignData.signData(addressHex, payload, privateKey)
      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, signedMessage)

      expect(isValid).toBe(true)
    })
  })

  describe("Property-based tests", () => {
    it("property: every signed message can be verified", () => {
      FastCheck.assert(
        FastCheck.property(
          PrivateKey.arbitrary,
          FastCheck.uint8Array({ minLength: 0, maxLength: 100 }),
          (privateKey, payloadBytes) => {
            const keyHash = KeyHash.fromPrivateKey(privateKey)
            const addressHex = KeyHash.toHex(keyHash)

            const payload = payloadBytes as Utils.Payload

            const signedMessage = SignData.signData(addressHex, payload, privateKey)
            const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, signedMessage)

            expect(isValid).toBe(true)
          }
        ),
        { numRuns: 100 }
      )
    })

    it("property: verification fails with wrong payload", () => {
      FastCheck.assert(
        FastCheck.property(
          PrivateKey.arbitrary,
          FastCheck.uint8Array({ minLength: 1, maxLength: 50 }),
          FastCheck.uint8Array({ minLength: 1, maxLength: 50 }),
          (privateKey, payloadBytes1, payloadBytes2) => {
            // Ensure payloads are different
            if (Bytes.toHex(payloadBytes1) === Bytes.toHex(payloadBytes2)) {
              return true
            }

            const keyHash = KeyHash.fromPrivateKey(privateKey)
            const addressHex = KeyHash.toHex(keyHash)

            const payload1 = payloadBytes1 as Utils.Payload
            const payload2 = payloadBytes2 as Utils.Payload

            const signedMessage = SignData.signData(addressHex, payload1, privateKey)
            const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload2, signedMessage)

            expect(isValid).toBe(false)
          }
        ),
        { numRuns: 50 }
      )
    })

    it("property: verification fails with wrong key", () => {
      FastCheck.assert(
        FastCheck.property(
          PrivateKey.arbitrary,
          PrivateKey.arbitrary,
          FastCheck.uint8Array({ minLength: 0, maxLength: 100 }),
          (privateKey1, privateKey2, payloadBytes) => {
            const keyHash1 = KeyHash.fromPrivateKey(privateKey1)
            const keyHash2 = KeyHash.fromPrivateKey(privateKey2)

            // If the keys happen to be the same, skip this test case
            if (Bytes.toHex(keyHash1.hash) === Bytes.toHex(keyHash2.hash)) {
              return true
            }

            const addressHex = KeyHash.toHex(keyHash1)
            const payload = payloadBytes as Utils.Payload

            const signedMessage = SignData.signData(addressHex, payload, privateKey1)
            const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash2), payload, signedMessage)

            expect(isValid).toBe(false)
          }
        ),
        { numRuns: 50 }
      )
    })

    it("property: text roundtrip preserves content", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.string({ minLength: 0, maxLength: 200 }), (text) => {
          const payload = Utils.fromText(text)
          const decoded = Utils.toText(payload)
          expect(decoded).toBe(text)
        }),
        { numRuns: 100 }
      )
    })
  })

  describe("COSE Sign1 Builder with External AAD (Emurgo example)", () => {
    it("should create and verify a signed message using COSESign1Builder with external AAD", () => {
      // 1) Create keys and message (matching Emurgo example)
      const skBytes = new Uint8Array([
        34, 125, 55, 10, 222, 244, 31, 91, 181, 231, 62, 80, 90, 53, 246, 160, 226, 111, 123, 228, 188, 90, 15, 130,
        210, 206, 78, 199, 209, 18, 202, 234
      ])
      const privateKey = PrivateKey.fromBytes(skBytes)
      const publicKey = PrivateKey.toPublicKey(privateKey)

      const payload = Utils.fromText("message to sign")
      const externalAAD = Utils.fromText("externally supplied data not in sign object")

      // 2) Creating a simple signed message
      const protectedHeaders = Header.headerMapNew()
      const unprotectedHeaders = Header.headerMapNew()
      const headers = Header.headersNew(protectedHeaders, unprotectedHeaders)

      // Use COSESign1Builder
      let builder = COSESign1.coseSign1BuilderNew(headers, payload, false)

      // Set external AAD
      builder = builder.setExternalAad(externalAAD)

      // Create SigStructure to sign
      const toSignBytes = builder.makeDataToSign()

      // Sign it using Ed25519
      const signature = PrivateKey.sign(privateKey, toSignBytes)

      // Build the final COSESign1
      const coseSign1 = builder.build(signature)

      // 3) Verify the message (recipient side)
      // Carefully inspect the headers/payload to ensure verifying the correct sign object
      const payloadToVerify = coseSign1.payload
      const headersToVerify = coseSign1.headers
      expect(headersToVerify).toBeDefined()
      const signatureToVerify = coseSign1.signature

      // Reconstruct SigStructure for verification
      const sigStructBytes = coseSign1.signedData(externalAAD, undefined)

      // Verify the signature
      const isValid = VKey.verify(publicKey, sigStructBytes, signatureToVerify.bytes)
      expect(isValid).toBe(true)

      // Verify payload matches
      expect(Bytes.toHex(payloadToVerify!)).toBe(Bytes.toHex(payload))
    })

    it("should fail verification if external AAD is different", () => {
      const skBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(skBytes)
      const publicKey = PrivateKey.toPublicKey(privateKey)

      const payload = Utils.fromText("message to sign")
      const externalAAD1 = Utils.fromText("external data 1")
      const externalAAD2 = Utils.fromText("external data 2")

      // Create and sign with externalAAD1
      const protectedHeaders = Header.headerMapNew()
      const unprotectedHeaders = Header.headerMapNew()
      const headers = Header.headersNew(protectedHeaders, unprotectedHeaders)

      let builder = COSESign1.coseSign1BuilderNew(headers, payload, false)
      builder = builder.setExternalAad(externalAAD1)
      const toSignBytes = builder.makeDataToSign()
      const signature = PrivateKey.sign(privateKey, toSignBytes)
      const coseSign1 = builder.build(signature)

      // Try to verify with externalAAD2 (should fail)
      const sigStructBytes = coseSign1.signedData(externalAAD2, undefined)

      const isValid = VKey.verify(publicKey, sigStructBytes, coseSign1.signature.bytes)
      expect(isValid).toBe(false)
    })

    it("should work without external AAD", () => {
      const skBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(skBytes)
      const publicKey = PrivateKey.toPublicKey(privateKey)

      const payload = Utils.fromText("message to sign")

      // Create and sign without external AAD
      const protectedHeaders = Header.headerMapNew()
      const unprotectedHeaders = Header.headerMapNew()
      const headers = Header.headersNew(protectedHeaders, unprotectedHeaders)

      const builder = COSESign1.coseSign1BuilderNew(headers, payload, false)
      const toSignBytes = builder.makeDataToSign()
      const signature = PrivateKey.sign(privateKey, toSignBytes)
      const coseSign1 = builder.build(signature)

      // Verify without external AAD
      const sigStructBytes = coseSign1.signedData()

      const isValid = VKey.verify(publicKey, sigStructBytes, coseSign1.signature.bytes)
      expect(isValid).toBe(true)
    })

    it("should support external payload (detached payload)", () => {
      const skBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(skBytes)
      const publicKey = PrivateKey.toPublicKey(privateKey)

      const payload = Utils.fromText("external payload")

      // Create with external payload (isPayloadExternal = true)
      const protectedHeaders = Header.headerMapNew()
      const unprotectedHeaders = Header.headerMapNew()
      const headers = Header.headersNew(protectedHeaders, unprotectedHeaders)

      const builder = COSESign1.coseSign1BuilderNew(headers, payload, true)
      const toSignBytes = builder.makeDataToSign()
      const signature = PrivateKey.sign(privateKey, toSignBytes)
      const coseSign1 = builder.build(signature)

      // COSESign1 should have null payload
      const embeddedPayload = coseSign1.payload
      expect(embeddedPayload).toBeUndefined()

      // Verify with external payload
      const sigStructBytes = coseSign1.signedData(undefined, payload)

      const isValid = VKey.verify(publicKey, sigStructBytes, coseSign1.signature.bytes)
      expect(isValid).toBe(true)
    })
  })

  describe("Edge cases", () => {
    it("should return false for malformed COSE_Sign1", () => {
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex = "0" + Bytes.toHex(keyHash.hash) + "0".repeat(56)
      const payload = Utils.fromText("test")

      // Create a malformed signed message
      const badSignedMessage: SignData.SignedMessage = {
        signature: new Uint8Array([0x01, 0x02, 0x03]),
        key: new Uint8Array([0x04, 0x05, 0x06])
      }

      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, badSignedMessage)
      expect(isValid).toBe(false)
    })

    it("should return false for truncated signature", () => {
      const privateKeyBytes = PrivateKey.generate()
      const privateKey = PrivateKey.fromBytes(privateKeyBytes)
      const keyHash = KeyHash.fromPrivateKey(privateKey)
      const addressHex = KeyHash.toHex(keyHash)
      const payload = Utils.fromText("test")

      const signedMessage = SignData.signData(addressHex, payload, privateKey)

      // Truncate the signature
      const badSignedMessage: SignData.SignedMessage = {
        signature: signedMessage.signature.slice(0, 20),
        key: signedMessage.key
      }

      const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, badSignedMessage)
      expect(isValid).toBe(false)
    })
  })
})
