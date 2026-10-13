import { describe, expect, it } from "vitest"

import * as Bip32PrivateKey from "../src/Bip32PrivateKey.js"
import { COSESign1, SignData } from "../src/cose/index.js"
import * as VKey from "../src/VKey.js"

/**
 * CIP-8 allows the signing public key to travel in the protected headers as `kid` (label 4).
 *
 * It is optional in the spec and CIP-30 wallets differ, but a verifier holding only the
 * COSE_Sign1 — no COSE_Key beside it — cannot recover the key without it, so services that
 * verify a bare signature require it. `signData` could not produce it at all.
 */
describe("signData key id", () => {
  const key = Bip32PrivateKey.toPrivateKey(Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16)))
  const address = "61" + "09".repeat(28)
  const payload = new TextEncoder().encode("hello")

  const protectedKid = (signatureBytes: Uint8Array) => {
    const sign1 = COSESign1.coseSign1FromCBORBytes(signatureBytes)
    for (const [label, value] of sign1.headers.protected.headers.entries()) {
      if (typeof label.value === "bigint" && label.value === 4n) return value as Uint8Array
    }
    return undefined
  }

  it("omits the kid by default, so existing signatures are unchanged", () => {
    expect(protectedKid(SignData.signData(address, payload, key).signature)).toBeUndefined()
  })

  it("includes the signing public key when asked", () => {
    const signed = SignData.signData(address, payload, key, { includeKeyId: true })
    expect(protectedKid(signed.signature)).toStrictEqual(VKey.fromPrivateKey(key).bytes)
  })

  it("changes the signed bytes, which is why it is opt-in", () => {
    const without = SignData.signData(address, payload, key).signature
    const with_ = SignData.signData(address, payload, key, { includeKeyId: true }).signature
    expect(Buffer.from(with_).toString("hex")).not.toBe(Buffer.from(without).toString("hex"))
  })
})
