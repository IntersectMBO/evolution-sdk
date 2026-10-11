import { describe, expect, it } from "vitest"

import * as Bip32PrivateKey from "../src/Bip32PrivateKey.js"
import * as Bip32PublicKey from "../src/Bip32PublicKey.js"

/**
 * Path construction and public-only derivation.
 *
 * `CardanoPath.indices` hardcoded purpose 1852 and typed `role` as `0 | 2`, so neither CIP-1854
 * (shared wallets) nor role 3 (DRep) could be expressed. `Bip32PublicKey` had single-step
 * `deriveChild` but no path form, which is what deriving addresses from a co-signer's account
 * xpub — no seed, no signing ceremony — actually needs.
 */
describe("CardanoPath", () => {
  const { CardanoPath, PURPOSE_CIP1852, PURPOSE_CIP1854 } = Bip32PrivateKey
  const hardened = (n: number) => (0x8000_0000 + n) >>> 0

  it("keeps the existing wrappers on CIP-1852", () => {
    expect(CardanoPath.paymentIndices(0, 7)).toStrictEqual([hardened(1852), hardened(1815), hardened(0), 0, 7])
    expect(CardanoPath.stakeIndices(1, 0)).toStrictEqual([hardened(1852), hardened(1815), hardened(1), 2, 0])
  })

  it("reaches role 3, which the old union could not express", () => {
    expect(CardanoPath.drepIndices(0, 0)[3]).toBe(3)
    expect(CardanoPath.indices(0, 4, 0)[3]).toBe(4)
  })

  it("builds CIP-1854 paths that differ from CIP-1852 only in purpose", () => {
    const ordinary = CardanoPath.paymentIndices(2, 5)
    const multisig = CardanoPath.multisigPaymentIndices(2, 5)
    expect(multisig[0]).toBe(hardened(PURPOSE_CIP1854))
    expect(ordinary[0]).toBe(hardened(PURPOSE_CIP1852))
    expect(multisig.slice(1)).toStrictEqual(ordinary.slice(1))
  })

  it("⚠️ a CIP-1854 key is a DIFFERENT key, never interchangeable with CIP-1852", () => {
    const root = Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16))
    const at = (indices: Array<number>) =>
      Bip32PublicKey.toHex(Bip32PrivateKey.toPublicKey(Bip32PrivateKey.derive(root, indices)))
    expect(at(CardanoPath.multisigPaymentIndices(0, 0))).not.toBe(at(CardanoPath.paymentIndices(0, 0)))
  })
})

describe("Bip32PublicKey.derivePath", () => {
  const root = Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16))
  const accountXpub = Bip32PrivateKey.toPublicKey(
    Bip32PrivateKey.derive(root, Bip32PrivateKey.CardanoPath.indices(0, 0, 0).slice(0, 3))
  )

  it("agrees with folding deriveChild by hand", () => {
    const stepwise = Bip32PublicKey.deriveChild(Bip32PublicKey.deriveChild(accountXpub, 0), 4)
    expect(Bip32PublicKey.toHex(Bip32PublicKey.derivePath(accountXpub, [0, 4]))).toBe(
      Bip32PublicKey.toHex(stepwise)
    )
  })

  it("agrees with deriving the same path from the private key", () => {
    const viaPrivate = Bip32PrivateKey.toPublicKey(
      Bip32PrivateKey.derive(root, [...Bip32PrivateKey.CardanoPath.indices(0, 0, 0).slice(0, 3), 0, 4])
    )
    expect(Bip32PublicKey.toHex(Bip32PublicKey.derivePath(accountXpub, [0, 4]))).toBe(
      Bip32PublicKey.toHex(viaPrivate)
    )
  })

  it("an empty path is the identity", () => {
    expect(Bip32PublicKey.toHex(Bip32PublicKey.derivePath(accountXpub, []))).toBe(
      Bip32PublicKey.toHex(accountXpub)
    )
  })

  it("⚠️ throws on a hardened index rather than deriving the wrong key", () => {
    // Every private-side path is written `0x80000000 + n`, so passing one here is an easy slip.
    expect(() => Bip32PublicKey.derivePath(accountXpub, [(0x8000_0000 + 0) >>> 0])).toThrow(/hardened/)
    expect(() => Bip32PublicKey.derivePath(accountXpub, [0, 0x8000_0000])).toThrow(/hardened/)
  })

  it("throws on a negative or non-integer index", () => {
    expect(() => Bip32PublicKey.derivePath(accountXpub, [-1])).toThrow(/non-negative integer/)
    expect(() => Bip32PublicKey.derivePath(accountXpub, [1.5])).toThrow(/non-negative integer/)
  })
})
