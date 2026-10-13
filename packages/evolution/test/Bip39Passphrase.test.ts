import { describe, expect, it } from "vitest"

import * as Bip32PrivateKey from "../src/Bip32PrivateKey.js"

/**
 * A BIP-39 passphrase is a byte string, not text.
 *
 * `fromBip39Entropy` took `string` only, so a caller holding raw bytes had to decode them as
 * UTF-8 first. Bytes that are not valid UTF-8 do not survive that: they decode to U+FFFD, and
 * the key derived from the mangled passphrase is a different key — a different wallet, with no
 * error anywhere to say so.
 */
describe("BIP-39 passphrases are bytes", () => {
  const entropy = new Uint8Array(16)

  it("a non-UTF-8 passphrase derives from its own bytes, not from U+FFFD", () => {
    const raw = Bip32PrivateKey.toHex(Bip32PrivateKey.fromBip39Entropy(entropy, new Uint8Array([0xff])))
    const mangled = Bip32PrivateKey.toHex(
      Bip32PrivateKey.fromBip39Entropy(entropy, Buffer.from([0xff]).toString("utf8"))
    )
    expect(raw).not.toBe(mangled)
  })

  it("bytes and the equivalent text agree when the text IS the bytes", () => {
    const text = "correct horse"
    const viaText = Bip32PrivateKey.toHex(Bip32PrivateKey.fromBip39Entropy(entropy, text))
    const viaBytes = Bip32PrivateKey.toHex(
      Bip32PrivateKey.fromBip39Entropy(entropy, new TextEncoder().encode(text))
    )
    expect(viaBytes).toBe(viaText)
  })

  it("an empty passphrase is unchanged", () => {
    expect(Bip32PrivateKey.toHex(Bip32PrivateKey.fromBip39Entropy(entropy, new Uint8Array()))).toBe(
      Bip32PrivateKey.toHex(Bip32PrivateKey.fromBip39Entropy(entropy))
    )
  })
})
