import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import { SignData } from "../src/cose/index.js"
import * as Sign1 from "../src/cose/Sign1.js"
import * as Utils from "../src/cose/Utils.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"

// Issue #480: a COSE_Sign1's protected header is a bstr whose exact bytes are
// what the signature covers (RFC 9052). A signer may emit those bytes in a
// non-minimal encoding — here the algorithm label 1 written as a two-byte
// uint (0x18 0x01) instead of one byte (0x01). Decoding must preserve the
// received bytes and signedData() / re-encoding must replay them, otherwise
// verifyData rejects a valid signature.

const addressHexFor = (keyHash: KeyHash.KeyHash): string =>
  Address.toHex(new Address.Address({ networkId: 0, paymentCredential: keyHash }))

const bstrHeader = (length: number): Array<number> => (length < 24 ? [0x40 + length] : [0x58, length])

/**
 * Build a COSE_Sign1 whose protected headers use the non-minimal label
 * encoding, signed with `privateKey` over those exact bytes. Returns the
 * assembled CBOR bytes plus the Sig_structure the signature covers.
 */
const buildNonMinimallyEncodedSign1 = (
  privateKey: PrivateKey.PrivateKey,
  addressHex: string,
  payload: Uint8Array
): { assembled: Uint8Array; sigStructure: Uint8Array; originalSignature: Uint8Array } => {
  const genuine = SignData.signData(addressHex, payload as Utils.Payload, privateKey)
  const parts = CBOR.fromCBORBytes(genuine.signature) as unknown as ReadonlyArray<unknown>
  const protectedMap = CBOR.fromCBORBytes(parts[0] as Uint8Array) as Map<unknown, unknown>
  const unprotected = parts[1] as Map<CBOR.CBOR, CBOR.CBOR>

  let addressBytes: Uint8Array | undefined
  for (const [key, value] of protectedMap.entries()) {
    if (key === "address") addressBytes = value as Uint8Array
  }
  if (addressBytes === undefined) throw new Error("protected headers carry no address")

  // a2 / label 1 as 0x18 0x01 / alg value -8 (0x27) / "address" / bstr
  const nonMinimalProtected = new Uint8Array([
    0xa2,
    0x18,
    0x01,
    0x27,
    0x67,
    ...new TextEncoder().encode("address"),
    ...bstrHeader(addressBytes.length),
    ...addressBytes
  ])

  const sigStructure = CBOR.toCBORBytes(["Signature1", nonMinimalProtected, new Uint8Array(), payload])
  const signature = PrivateKey.sign(privateKey, sigStructure)
  const assembled = CBOR.toCBORBytes([nonMinimalProtected, unprotected, payload, signature.bytes])
  return { assembled, sigStructure, originalSignature: parts[3] as Uint8Array }
}

describe("COSE_Sign1 protected-header byte preservation (#480)", () => {
  it("verifyData accepts a valid signature over non-minimally encoded protected headers", () => {
    const privateKey = PrivateKey.fromBytes(PrivateKey.generate())
    const keyHash = KeyHash.fromPrivateKey(privateKey)
    const addressHex = addressHexFor(keyHash)
    const payload = Utils.fromText("Hello, Cardano!")

    const { assembled } = buildNonMinimallyEncodedSign1(privateKey, addressHex, payload)
    const genuine = SignData.signData(addressHex, payload, privateKey)

    const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, {
      signature: assembled,
      key: genuine.key
    })
    expect(isValid).toBe(true)
  })

  it("signedData() replays the original protected-header bytes", () => {
    const privateKey = PrivateKey.fromBytes(PrivateKey.generate())
    const keyHash = KeyHash.fromPrivateKey(privateKey)
    const addressHex = addressHexFor(keyHash)
    const payload = Utils.fromText("Hello, Cardano!")

    const { assembled, sigStructure } = buildNonMinimallyEncodedSign1(privateKey, addressHex, payload)
    const decoded = Sign1.coseSign1FromCBORBytes(assembled)
    expect(Bytes.toHex(decoded.signedData())).toBe(Bytes.toHex(sigStructure))
  })

  it("re-encoding a decoded COSE_Sign1 reproduces the original bytes", () => {
    const privateKey = PrivateKey.fromBytes(PrivateKey.generate())
    const keyHash = KeyHash.fromPrivateKey(privateKey)
    const addressHex = addressHexFor(keyHash)
    const payload = Utils.fromText("Hello, Cardano!")

    const { assembled } = buildNonMinimallyEncodedSign1(privateKey, addressHex, payload)
    const decoded = Sign1.coseSign1FromCBORBytes(assembled)
    expect(Bytes.toHex(Sign1.coseSign1ToCBORBytes(decoded))).toBe(Bytes.toHex(assembled))
  })

  it("a signature over the canonical re-encode does not verify against different protected bytes", () => {
    const privateKey = PrivateKey.fromBytes(PrivateKey.generate())
    const keyHash = KeyHash.fromPrivateKey(privateKey)
    const addressHex = addressHexFor(keyHash)
    const payload = Utils.fromText("Hello, Cardano!")

    const { assembled, originalSignature } = buildNonMinimallyEncodedSign1(privateKey, addressHex, payload)
    // Swap the valid signature for the one signData made over the canonical
    // encoding of the same headers: those bytes are not what was signed here.
    const parts = CBOR.fromCBORBytes(assembled) as unknown as ReadonlyArray<unknown>
    const mismatched = CBOR.toCBORBytes([parts[0], parts[1], parts[2], originalSignature])
    const genuine = SignData.signData(addressHex, payload, privateKey)

    const isValid = SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, {
      signature: mismatched,
      key: genuine.key
    })
    expect(isValid).toBe(false)
  })
})
