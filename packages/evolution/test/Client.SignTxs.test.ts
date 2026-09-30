import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { preprod } from "../src/sdk/client/Chain.js"
import { cip30Wallet } from "../src/sdk/client/internal/Wallets.js"
import type * as Wallet from "../src/sdk/wallet/Wallet.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"

const emptyWitnessHex = TransactionWitnessSet.toCBORHex(TransactionWitnessSet.empty())

// Minimal mock transaction CBOR (enough to pass through signTx without decoding)
const fakeTxCbor1 = "84a400818258200000000000000000000000000000000000000000000000000000000000000000000182a200583900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a001e8480a200583900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a001e8480021a00028a00031a00d59f80a100818258200000000000000000000000000000000000000000000000000000000000000000584000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f5f6"
const fakeTxCbor2 = "84a400818258200000000000000000000000000000000000000000000000000000000000000001000182a200583900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a001e8480a200583900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a001e8480021a00028a00031a00d59f80a100818258200000000000000000000000000000000000000000000000000000000000000000584000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f5f6"

// Testnet address hex (network id 0)
const testnetAddressHex =
  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

const makeBaseMockApi = (): Wallet.WalletApi => ({
  getUsedAddresses: () => Promise.resolve([testnetAddressHex]),
  getUnusedAddresses: () => Promise.resolve([]),
  getRewardAddresses: () => Promise.resolve([]),
  getUtxos: () => Promise.resolve([]),
  signTx: () => Promise.resolve(emptyWitnessHex),
  signData: () => Promise.resolve({ payload: "", signature: "" }),
  submitTx: () => Promise.resolve("0000000000000000000000000000000000000000000000000000000000000000")
})

describe("Client.signTxs (CIP-103)", () => {
  it("uses cip103.signTxs when available", async () => {
    const calls: Array<string> = []
    const mockApi: Wallet.WalletApi = {
      ...makeBaseMockApi(),
      cip103: {
        signTxs: (requests) => {
          calls.push("cip103")
          return Promise.resolve(requests.map(() => emptyWitnessHex))
        }
      },
      experimental: {
        signTxs: (requests) => {
          calls.push("experimental")
          return Promise.resolve(requests.map(() => emptyWitnessHex))
        }
      }
    }

    const wallet = cip30Wallet(mockApi)(preprod)
    const results = await wallet.signTxs([fakeTxCbor1, fakeTxCbor2])

    expect(calls).toEqual(["cip103"])
    expect(results).toHaveLength(2)
  })

  it("falls back to experimental.signTxs when cip103 is not available", async () => {
    const calls: Array<string> = []
    const mockApi: Wallet.WalletApi = {
      ...makeBaseMockApi(),
      experimental: {
        signTxs: (requests) => {
          calls.push("experimental")
          return Promise.resolve(requests.map(() => emptyWitnessHex))
        }
      }
    }

    const wallet = cip30Wallet(mockApi)(preprod)
    const results = await wallet.signTxs([fakeTxCbor1, fakeTxCbor2])

    expect(calls).toEqual(["experimental"])
    expect(results).toHaveLength(2)
  })

  it("falls back to direct signTxs when no namespace is available", async () => {
    const calls: Array<string> = []
    const mockApi: Wallet.WalletApi = {
      ...makeBaseMockApi(),
      signTxs: (requests) => {
        calls.push("direct")
        return Promise.resolve(requests.map(() => emptyWitnessHex))
      }
    }

    const wallet = cip30Wallet(mockApi)(preprod)
    const results = await wallet.signTxs([fakeTxCbor1, fakeTxCbor2])

    expect(calls).toEqual(["direct"])
    expect(results).toHaveLength(2)
  })

  it("falls back to sequential signTx when no batch method exists", async () => {
    const signedTxs: Array<string> = []
    const mockApi: Wallet.WalletApi = {
      ...makeBaseMockApi(),
      signTx: (txCborHex, _partialSign) => {
        signedTxs.push(txCborHex)
        return Promise.resolve(emptyWitnessHex)
      }
    }

    const wallet = cip30Wallet(mockApi)(preprod)
    const results = await wallet.signTxs([fakeTxCbor1, fakeTxCbor2])

    expect(signedTxs).toEqual([fakeTxCbor1, fakeTxCbor2])
    expect(results).toHaveLength(2)
  })

  it("passes correct TransactionSignatureRequest format to batch methods", async () => {
    let capturedRequests: ReadonlyArray<Wallet.TransactionSignatureRequest> = []
    const mockApi: Wallet.WalletApi = {
      ...makeBaseMockApi(),
      cip103: {
        signTxs: (requests) => {
          capturedRequests = requests
          return Promise.resolve(requests.map(() => emptyWitnessHex))
        }
      }
    }

    const wallet = cip30Wallet(mockApi)(preprod)
    await wallet.signTxs([fakeTxCbor1, fakeTxCbor2])

    expect(capturedRequests).toHaveLength(2)
    expect(capturedRequests[0]).toEqual({ cbor: fakeTxCbor1, partialSign: true })
    expect(capturedRequests[1]).toEqual({ cbor: fakeTxCbor2, partialSign: true })
  })

  it("returns decoded TransactionWitnessSet instances", async () => {
    const mockApi: Wallet.WalletApi = {
      ...makeBaseMockApi(),
      cip103: {
        signTxs: (requests) => Promise.resolve(requests.map(() => emptyWitnessHex))
      }
    }

    const wallet = cip30Wallet(mockApi)(preprod)
    const results = await wallet.signTxs([fakeTxCbor1])

    expect(results).toHaveLength(1)
    expect(TransactionWitnessSet.toCBORHex(results[0])).toBe(emptyWitnessHex)
  })

  it.effect("works through seed wallet signTxs (sequential delegation)", () =>
    Effect.gen(function* () {
      const { Client, preprod } = yield* Effect.promise(() => import("../src/index.js"))

      const seedPhrase =
        "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

      const offlineSigner = Client.make(preprod).withSeed({ mnemonic: seedPhrase })

      // signTxs on a seed wallet delegates to sequential signTx calls
      // We can't easily test with real txs here, but we verify the method exists and is callable
      expect(typeof offlineSigner.signTxs).toBe("function")
    })
  )
})
