import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Data from "../src/Data.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import * as CoreTransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const baseConfig: TxBuilderConfig = { chain: mainnet }

describe("TxBuilder NativeScript Spend (#339)", () => {
  it("should not create redeemers when spending from a native script address with a redeemer passed", async () => {
    // Create a native script
    const dummyKeyHash = new Uint8Array(28).fill(0xaa)
    const nativeScript = NativeScripts.makeScriptPubKey(dummyKeyHash)
    const scriptHash = ScriptHash.fromScript(nativeScript)

    // Create a script address using the native script hash
    const scriptAddress = new CoreAddress.Address({
      networkId: 0,
      paymentCredential: scriptHash,
      stakingCredential: undefined
    })

    // Create a UTxO at the script address
    const scriptUtxo = new CoreUTxO.UTxO({
      transactionId: CoreTransactionHash.fromHex("b".repeat(64)),
      index: 0n,
      address: scriptAddress,
      assets: CoreAssets.fromLovelace(10_000_000n)
    })

    // Wallet UTxO for fees/change
    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    // Bug reproduction: user passes a redeemer to collectFrom even though
    // the UTxO is at a native script address. The builder should ignore the
    // redeemer for native script UTxOs instead of creating a spend redeemer.
    const signBuilder = await makeTxBuilder(baseConfig)
      .attachScript({ script: nativeScript })
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: new Data.Constr({ index: 0n, fields: [] })
      })
      .payToAddress({
        address: CoreAddress.fromBech32(CHANGE_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()

    // The native script must be in the witness set
    expect(tx.witnessSet.nativeScripts.length).toBeGreaterThan(0)

    // There must be NO redeemers (native scripts use signatures, not redeemers)
    expect(tx.witnessSet.redeemers).toBeUndefined()

    // There must be NO scriptDataHash (only needed for Plutus scripts)
    expect(tx.body.scriptDataHash).toBeUndefined()

    // There must be NO collateral (only needed for Plutus scripts)
    expect(tx.body.collateralInputs).toBeUndefined()
  })
})
