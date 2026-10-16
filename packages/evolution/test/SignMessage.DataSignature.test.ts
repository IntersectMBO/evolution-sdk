import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import { SignData } from "../src/cose/index.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import { preprod } from "../src/sdk/client/Chain.js"
import { cip30Wallet, seedWallet } from "../src/sdk/client/internal/Wallets.js"
import { keysFromSeed } from "../src/sdk/wallet/Derivation.js"
import type * as Wallet from "../src/sdk/wallet/Wallet.js"

const mnemonic =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

describe("signMessage returns the complete CIP-30 DataSignature (#481)", () => {
  it("seed wallet: result carries the COSE_Key hex alongside the signature", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const address = await wallet.address()

    const result = await wallet.signMessage(address, "Hello, Cardano!")

    expect(typeof result.key).toBe("string")
    expect(result.key.length).toBeGreaterThan(0)
    // The key is hex-encoded CBOR, not raw bytes or bech32
    expect(Bytes.fromHex(result.key).length).toBeGreaterThan(0)
  })

  it("seed wallet: verifyData verifies using only the returned signature and key", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const address = await wallet.address()
    const payload = new TextEncoder().encode("Hello, Cardano!")

    const result = await wallet.signMessage(address, payload)

    const paymentKey = PrivateKey.fromBech32(keysFromSeed(mnemonic).paymentKey)
    const keyHash = KeyHash.fromPrivateKey(paymentKey)
    const isValid = SignData.verifyData(Address.toHex(address), KeyHash.toHex(keyHash), payload, {
      signature: Bytes.fromHex(result.signature),
      key: Bytes.fromHex(result.key)
    })
    expect(isValid).toBe(true)
  })

  it("seed wallet: returned key matches the COSE_Key SignData produces for the signing key", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const address = await wallet.address()
    const payload = new TextEncoder().encode("Hello, Cardano!")

    const result = await wallet.signMessage(address, payload)

    const paymentKey = PrivateKey.fromBech32(keysFromSeed(mnemonic).paymentKey)
    const expected = SignData.signData(Address.toHex(address), payload, paymentKey)
    expect(result.key).toBe(Bytes.toHex(expected.key))
    expect(result.signature).toBe(Bytes.toHex(expected.signature))
  })

  it("CIP-30 api wallet: signMessage carries the extension's key through", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const address = await wallet.address()
    const addressHex = Address.toHex(address)

    const api: Wallet.WalletApi = {
      getUsedAddresses: () => Promise.resolve([addressHex]),
      getUnusedAddresses: () => Promise.resolve([]),
      getRewardAddresses: () => Promise.resolve([]),
      getUtxos: () => Promise.resolve([]),
      signTx: () => Promise.reject(new Error("not used")),
      signData: (_addressHex: string, payload: Wallet.Payload) =>
        Promise.resolve({ payload, signature: "deadbeef", key: "cafebabe" }),
      submitTx: () => Promise.reject(new Error("not used"))
    }
    const apiWallet = cip30Wallet(api)(preprod)

    const result = await apiWallet.signMessage(address, "Hello, Cardano!")
    expect(result.signature).toBe("deadbeef")
    expect(result.key).toBe("cafebabe")
  })
})
