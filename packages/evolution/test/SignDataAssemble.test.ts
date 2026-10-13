import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Bip32PrivateKey from "../src/Bip32PrivateKey.js"
import { COSESign1, SignData } from "../src/cose/index.js"
import * as Ed25519Signature from "../src/Ed25519Signature.js"
import * as KeyHash from "../src/KeyHash.js"
import * as VKey from "../src/VKey.js"

/**
 * `signData` needs a `PrivateKey`, which a hardware wallet never surrenders: the device is handed
 * the `Sig_structure`, signs it internally, and returns only the signature. Without a way to
 * assemble the COSE_Sign1 around an external signature, a Ledger- or Trezor-backed wallet cannot
 * serve CIP-30 `signData` at all.
 *
 * The oracle here is `signData` itself: given the signature it produced, `assembleSignData` must
 * rebuild byte-identical output. That pins the assembly to the layout the signing path already
 * emits, rather than to a second opinion about what CIP-8 means.
 */
describe("assembleSignData", () => {
  const key = Bip32PrivateKey.toPrivateKey(Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16)))
  const publicKey = VKey.fromPrivateKey(key)
  // ⚠️ A real address for this key. `verifyData` binds the signing key to the address
  // credential, so a bare key-hash-shaped address is rejected however good the signature is.
  const keyHash = KeyHash.fromPrivateKey(key)
  const address = Address.toHex(new Address.Address({ networkId: 0, paymentCredential: keyHash }))
  const payload = new TextEncoder().encode("hello")

  /** The signature `signData` produced, recovered from its own output. */
  const signatureOf = (signed: SignData.SignedMessage) =>
    COSESign1.coseSign1FromCBORBytes(signed.signature).signature

  it("rebuilds signData's bytes exactly, given signData's own signature", () => {
    const signed = SignData.signData(address, payload, key)
    const assembled = SignData.assembleSignData(address, payload, {
      hashed: false,
      publicKey,
      signature: signatureOf(signed)
    })
    expect(assembled.signature).toEqual(signed.signature)
    expect(assembled.key).toEqual(signed.key)
  })

  it("produces a signature that verifies", () => {
    const signed = SignData.signData(address, payload, key)
    const assembled = SignData.assembleSignData(address, payload, {
      hashed: false,
      publicKey,
      signature: signatureOf(signed)
    })
    expect(SignData.verifyData(address, KeyHash.toHex(keyHash), payload, assembled)).toBe(true)
  })

  it("writes no kid, because device firmware signs headers without one", () => {
    const signed = SignData.signData(address, payload, key)
    const assembled = SignData.assembleSignData(address, payload, {
      hashed: false,
      publicKey,
      signature: signatureOf(signed)
    })
    const sign1 = COSESign1.coseSign1FromCBORBytes(assembled.signature)
    const labels = [...sign1.headers.protected.headers.keys()].map((l) => l.value)
    expect(labels).not.toContain(4n)
  })

  it("omits the address header when the device omitted it", () => {
    const signed = SignData.signData(address, payload, key)
    const assembled = SignData.assembleSignData(undefined, payload, {
      hashed: false,
      publicKey,
      signature: signatureOf(signed)
    })
    const sign1 = COSESign1.coseSign1FromCBORBytes(assembled.signature)
    const labels = [...sign1.headers.protected.headers.keys()].map((l) => String(l.value))
    expect(labels).not.toContain("address")
    // and the bytes differ from the addressed form, because the signed headers differ
    expect(assembled.signature).not.toEqual(signed.signature)
  })

  it("sets the CIP-8 hashed flag and signs the digest when hashed", () => {
    // The device hashes before signing, so the signature is over the digest. Sign the digest
    // here with the same key to get a signature that matches what a device would return.
    const digest = new Uint8Array(28)
    const hashedSigned = SignData.signData(address, digest, key)
    const assembled = SignData.assembleSignData(address, payload, {
      hashed: true,
      publicKey,
      signature: signatureOf(hashedSigned)
    })
    const sign1 = COSESign1.coseSign1FromCBORBytes(assembled.signature)
    const entries = [...sign1.headers.unprotected.headers.entries()].map(([l, v]) => [String(l.value), v])
    expect(entries).toContainEqual(["hashed", true])
    // the payload carried is the 28-byte digest, not the message
    expect(sign1.payload?.length).toBe(28)
  })

  it("accepts a signature produced anywhere, since the device is the signer", () => {
    // Nothing about the assembly depends on holding the key: the same call works with a
    // signature made by PrivateKey.sign over the Sig_structure the assembly implies.
    const signed = SignData.signData(address, payload, key)
    const raw = Ed25519Signature.toHex(signatureOf(signed))
    const assembled = SignData.assembleSignData(address, payload, {
      hashed: false,
      publicKey,
      signature: Ed25519Signature.fromHex(raw)
    })
    expect(assembled.signature).toEqual(signed.signature)
  })
})
