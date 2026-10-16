import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as KeyHash from "../src/KeyHash.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as PrivateKey from "../src/PrivateKey.js"
import { preprod } from "../src/sdk/client/Chain.js"
import { signTxsWithAutoFetch, signWithAutoFetch } from "../src/sdk/client/internal/Signing.js"
import { seedWallet } from "../src/sdk/client/internal/Wallets.js"
import type * as Provider from "../src/sdk/provider/Provider.js"
import { keysFromSeed } from "../src/sdk/wallet/Derivation.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionInput from "../src/TransactionInput.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as CoreUTxO from "../src/UTxO.js"

const mnemonic =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

const keys = keysFromSeed(mnemonic)
const paymentKey = PrivateKey.fromBech32(keys.paymentKey)
const paymentKh = KeyHash.fromPrivateKey(paymentKey)

// A reference UTxO carrying a native script that names the wallet's payment
// key hash: any transaction that (wrongly) counts it as a required signer
// source will produce a vkey witness from this wallet.
const scriptTxId = TransactionHash.fromHex("aa".repeat(32))
const scriptUtxo = new CoreUTxO.UTxO({
  transactionId: scriptTxId,
  index: 0n,
  address: new CoreAddress.Address({ networkId: 0, paymentCredential: KeyHash.fromHex("00".repeat(28)) }),
  assets: CoreAssets.fromLovelace(2_000_000n),
  scriptRef: NativeScripts.makeScriptPubKey(paymentKh.hash)
})
const scriptRefInput = new TransactionInput.TransactionInput({ transactionId: scriptTxId, index: 0n })

const plainTx = (): Transaction.Transaction =>
  new Transaction.Transaction({
    body: new TransactionBody.TransactionBody({ inputs: [], outputs: [], fee: 200_000n }),
    witnessSet: TransactionWitnessSet.empty(),
    isValid: true,
    auxiliaryData: null
  })

const referencingTx = (): Transaction.Transaction =>
  new Transaction.Transaction({
    body: new TransactionBody.TransactionBody({
      inputs: [],
      outputs: [],
      fee: 200_000n,
      referenceInputs: [scriptRefInput]
    }),
    witnessSet: TransactionWitnessSet.empty(),
    isValid: true,
    auxiliaryData: null
  })

// Provider stub: resolves any requested out ref to the script UTxO above.
const stubProvider = {
  effect: {
    getUtxosByOutRef: (inputs: ReadonlyArray<TransactionInput.TransactionInput>) =>
      Effect.succeed(inputs.map(() => scriptUtxo))
  }
} as unknown as Provider.Provider

const witnessKeyHashHexes = (ws: TransactionWitnessSet.TransactionWitnessSet): Array<string> =>
  (ws.vkeyWitnesses ?? []).map((w) => KeyHash.toHex(KeyHash.fromVKey(w.vkey)))

describe("batch signing scopes reference UTxOs per transaction (#483)", () => {
  it("a transaction that does not reference the script UTxO is not signed for it", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)

    const results = await Effect.runPromise(signTxsWithAutoFetch(stubProvider, wallet, [plainTx(), referencingTx()]))

    expect(witnessKeyHashHexes(results[0])).toEqual([])
    expect(witnessKeyHashHexes(results[1])).toEqual([KeyHash.toHex(paymentKh)])
  })

  it("scoping holds regardless of batch order", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)

    const results = await Effect.runPromise(signTxsWithAutoFetch(stubProvider, wallet, [referencingTx(), plainTx()]))

    expect(witnessKeyHashHexes(results[0])).toEqual([KeyHash.toHex(paymentKh)])
    expect(witnessKeyHashHexes(results[1])).toEqual([])
  })

  it("signTx ignores reference UTxOs the transaction does not reference (explicit context)", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)

    const witnessSet = await wallet.signTx(plainTx(), { referenceUtxos: [scriptUtxo] })

    expect(witnessKeyHashHexes(witnessSet)).toEqual([])
  })

  it("signTx signs for a reference UTxO the transaction does reference (control)", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)

    const witnessSet = await wallet.signTx(referencingTx(), { referenceUtxos: [scriptUtxo] })

    expect(witnessKeyHashHexes(witnessSet)).toEqual([KeyHash.toHex(paymentKh)])
  })

  it("single-transaction auto-fetch still signs for its own reference script (control)", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)

    const witnessSet = await Effect.runPromise(signWithAutoFetch(stubProvider, wallet, referencingTx()))

    expect(witnessKeyHashHexes(witnessSet)).toEqual([KeyHash.toHex(paymentKh)])
  })
})
