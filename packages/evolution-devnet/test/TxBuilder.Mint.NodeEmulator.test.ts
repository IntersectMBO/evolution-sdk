import { describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import * as AssetName from "@evolution-sdk/evolution/AssetName"
import * as NativeScripts from "@evolution-sdk/evolution/NativeScripts"
import * as PolicyId from "@evolution-sdk/evolution/PolicyId"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Text from "@evolution-sdk/evolution/Text"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

import { createNodeEmulatorSetup } from "./utils/nodeEmulator.js"

const CoreAssets = Cardano.Assets

describe("TxBuilder Minting (node-emulator)", () => {
  it("should mint, submit and find asset in UTxO", async () => {
    const { client, genesisUtxos, address } = await createNodeEmulatorSetup({ lovelace: 900_000_000_000n })

    const paymentKeyHash = address.paymentCredential.hash
    const nativeScript = NativeScripts.makeScriptPubKey(paymentKeyHash)
    const scriptHash = ScriptHash.fromScript(nativeScript)
    const policyId = ScriptHash.toHex(scriptHash)

    const assetNameHex = Text.toHex("IntegrationToken")
    const unit = policyId + assetNameHex

    const genesisUtxo = genesisUtxos.find((u) => CoreAddress.toBech32(u.address) === CoreAddress.toBech32(address))
    if (!genesisUtxo) throw new Error("Genesis UTxO not found")

    const signBuilder = await client
      .newTx()
      .attachScript({ script: nativeScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: 5000n })
      })
      .payToAddress({
        address,
        assets: CoreAssets.fromRecord({
          lovelace: 3_000_000n,
          [unit]: 5000n
        })
      })
      .build({ availableUtxos: [genesisUtxo] })

    const tx = await signBuilder.toTransaction()
    expect(tx.body.mint).toBeDefined()

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)

    const utxos = await client.getWalletUtxos()
    let foundMintedAsset = false
    let mintedAmount = 0n

    for (const utxo of utxos) {
      if (!utxo.assets.multiAsset) continue
      for (const [policyIdKey, assetMap] of utxo.assets.multiAsset.map.entries()) {
        if (PolicyId.toHex(policyIdKey) === policyId) {
          for (const [assetName, amount] of assetMap.entries()) {
            if (AssetName.toHex(assetName) === assetNameHex) {
              foundMintedAsset = true
              mintedAmount = amount
            }
          }
        }
      }
    }

    expect(foundMintedAsset).toBe(true)
    expect(mintedAmount).toBe(5000n)
  })

  it("should handle burning (negative amounts) with submit", async () => {
    const { client, genesisUtxos, address } = await createNodeEmulatorSetup({ lovelace: 900_000_000_000n })

    const paymentKeyHash = address.paymentCredential.hash
    const nativeScript = NativeScripts.makeScriptPubKey(paymentKeyHash)
    const scriptHash = ScriptHash.fromScript(nativeScript)
    const policyId = ScriptHash.toHex(scriptHash)

    const ASSET_NAME = "TestToken"
    const assetNameHex = Text.toHex(ASSET_NAME)
    const unit = policyId + assetNameHex

    // Step 1: Mint tokens
    const mintBuilder = await client
      .newTx()
      .attachScript({ script: nativeScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: 1000n })
      })
      .payToAddress({
        address,
        assets: CoreAssets.fromRecord({
          lovelace: 3_000_000n,
          [unit]: 1000n
        })
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const mintTx = await mintBuilder.toTransaction()
    expect(mintTx.body.mint).toBeDefined()

    const mintSubmitBuilder = await mintBuilder.sign()
    const mintTxHash = await mintSubmitBuilder.submit()
    const mintConfirmed = await client.awaitTx(mintTxHash, 1000)
    expect(mintConfirmed).toBe(true)

    // Step 2: Get UTxO with minted tokens
    const utxos = await client.getWalletUtxos()
    const utxoWithTokens = utxos.find((u) => CoreAssets.getByUnit(u.assets, unit) > 0n)
    if (!utxoWithTokens) throw new Error("UTxO with minted tokens not found")

    // Step 3: Burn some tokens
    const burnBuilder = await client
      .newTx()
      .attachScript({ script: nativeScript })
      .collectFrom({ inputs: [utxoWithTokens] })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: -500n })
      })
      .payToAddress({
        address,
        assets: CoreAssets.fromRecord({
          lovelace: 1_500_000n,
          [unit]: 500n
        })
      })
      .build({ availableUtxos: [] })

    const burnTx = await burnBuilder.toTransaction()
    expect(burnTx.body.mint).toBeDefined()

    let foundBurn = false
    for (const [policyIdKey, assetMap] of burnTx.body.mint!.map.entries()) {
      if (PolicyId.toHex(policyIdKey) === policyId) {
        for (const [assetName, amount] of assetMap.entries()) {
          if (AssetName.toHex(assetName) === assetNameHex && amount === -500n) {
            foundBurn = true
          }
        }
      }
    }
    expect(foundBurn).toBe(true)

    const burnSubmitBuilder = await burnBuilder.sign()
    const burnTxHash = await burnSubmitBuilder.submit()
    expect(TransactionHash.toHex(burnTxHash).length).toBe(64)

    const burnConfirmed = await client.awaitTx(burnTxHash, 1000)
    expect(burnConfirmed).toBe(true)

    const utxosAfterBurn = await client.getWalletUtxos()
    let remainingTokenAmount = 0n
    for (const utxo of utxosAfterBurn) {
      remainingTokenAmount += CoreAssets.getByUnit(utxo.assets, unit)
    }
    expect(remainingTokenAmount).toBe(500n)
  })
})
