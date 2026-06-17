import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as FeeValidation from "../src/FeeValidation.js"
import * as Mint from "../src/Mint.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as ScriptHash from "../src/ScriptHash.js"
import { calculateTransactionSize } from "../src/sdk/builders/internal/txBuilder.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import * as Text from "../src/Text.js"
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

// Create a native script for minting
const createNativeScript = () => {
  const dummyKeyHash = new Uint8Array(28).fill(0xaa)
  return NativeScripts.makeScriptPubKey(dummyKeyHash)
}

describe("TxBuilder Mint", () => {
  it("should build transaction with mint field", async () => {
    const utxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    const nativeScript = createNativeScript()
    const scriptHash = ScriptHash.fromScript(nativeScript)
    const policyId = ScriptHash.toHex(scriptHash)
    const assetNameHex = Text.toHex("TestToken")
    const unit = policyId + assetNameHex

    const signBuilder = await makeTxBuilder(baseConfig)
      .attachScript({ script: nativeScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: 1000n })
      })
      .payToAddress({
        address: CoreAddress.fromBech32(CHANGE_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Strict structure expectations
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(2) // Payment + change
    expect(tx.body.mint).toBeDefined()

    // Strict mint expectations
    const mint = tx.body.mint!
    expect(mint.map.size).toBe(1) // Exactly 1 policy

    // Use Mint utility functions for lookup
    const assetMap = Mint.getAssetsByPolicyHex(mint, policyId)
    expect(assetMap).toBeDefined()
    expect(assetMap!.size).toBe(1) // Exactly 1 asset under this policy

    const mintAmount = Mint.getByHex(mint, policyId, assetNameHex)
    expect(mintAmount).toBe(1000n) // Exact mint amount

    // Strict fee validation
    const validation = FeeValidation.validateTransactionFee(txWithFakeWitnesses, PROTOCOL_PARAMS)
    expect(validation.isValid).toBe(true)
    expect(validation.difference).toBeGreaterThanOrEqual(0n) // Fee can be overpaid

    const size = calculateTransactionSize(txWithFakeWitnesses)
    expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

    // Strict output expectations
    expect(tx.body.outputs[0].assets.lovelace).toBe(2_000_000n) // Payment output
  })

  it("should merge multiple mint calls", async () => {
    const utxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    const nativeScript = createNativeScript()
    const scriptHash = ScriptHash.fromScript(nativeScript)
    const policyId = ScriptHash.toHex(scriptHash)

    const assetName1Hex = Text.toHex("Token1")
    const assetName2Hex = Text.toHex("Token2")
    const unit1 = policyId + assetName1Hex
    const unit2 = policyId + assetName2Hex

    const signBuilder = await makeTxBuilder(baseConfig)
      .attachScript({ script: nativeScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit1]: 100n })
      })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit2]: 200n })
      })
      .payToAddress({
        address: CoreAddress.fromBech32(CHANGE_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [utxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    const txWithFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()

    // Strict structure expectations
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBe(2) // Payment + change
    expect(tx.body.mint).toBeDefined()

    // Strict mint expectations - both assets merged under same policy
    const mint = tx.body.mint!
    expect(mint.map.size).toBe(1) // Exactly 1 policy (same script)

    // Use Mint utility functions for lookup
    const assetMap = Mint.getAssetsByPolicyHex(mint, policyId)
    expect(assetMap).toBeDefined()
    expect(assetMap!.size).toBe(2) // Exactly 2 assets merged under this policy

    // Verify both assets with exact amounts
    expect(Mint.getByHex(mint, policyId, assetName1Hex)).toBe(100n) // Exact Token1 amount
    expect(Mint.getByHex(mint, policyId, assetName2Hex)).toBe(200n) // Exact Token2 amount

    // Strict fee validation
    const validation = FeeValidation.validateTransactionFee(txWithFakeWitnesses, PROTOCOL_PARAMS)
    expect(validation.isValid).toBe(true)
    expect(validation.difference).toBe(0n)

    const size = calculateTransactionSize(txWithFakeWitnesses)
    expect(size).toBeLessThanOrEqual(PROTOCOL_PARAMS.maxTxSize)

    // Strict output expectations
    expect(tx.body.outputs[0].assets.lovelace).toBe(2_000_000n) // Payment output
  })
})
