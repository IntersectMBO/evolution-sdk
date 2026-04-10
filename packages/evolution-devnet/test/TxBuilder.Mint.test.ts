import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import * as AssetName from "@evolution-sdk/evolution/AssetName"
import * as NativeScripts from "@evolution-sdk/evolution/NativeScripts"
import * as PolicyId from "@evolution-sdk/evolution/PolicyId"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Text from "@evolution-sdk/evolution/Text"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { inject } from "vitest"
import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

const CoreAssets = Cardano.Assets

describe("TxBuilder Minting (Devnet Submit)", () => {
  // ============================================================================
  // Devnet Setup
  // ============================================================================

  let shared: SharedClusterResult
  let nativeScript: NativeScripts.NativeScript
  let policyId: string

  const ASSET_NAME = "TestToken"

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [7])

    // Derive native script and policy ID from account 7's payment key
    const client = shared.makeClient(7)
    const address = await client.address()
    const paymentKeyHash = address.paymentCredential.hash

    nativeScript = NativeScripts.makeScriptPubKey(paymentKeyHash)
    const scriptHash = ScriptHash.fromScript(nativeScript)
    policyId = ScriptHash.toHex(scriptHash)
  }, 180_000)

  // ============================================================================
  // Submit Tests
  // ============================================================================

  it("should mint, submit and find asset in UTxO", { timeout: 30_000 }, async () => {
    const genesisUtxos = shared.genesisUtxos
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not calculated")
    }

    const client = shared.makeClient(7)
    const address = await client.address()

    // Use pre-calculated genesis UTxOs (Kupo may not have synced yet)
    const genesisUtxo = genesisUtxos.find((u) => CoreAddress.toBech32(u.address) === CoreAddress.toBech32(address))
    if (!genesisUtxo) {
      throw new Error("Genesis UTxO not found for wallet address")
    }

    const assetNameHex = Text.toHex("IntegrationToken")
    const unit = policyId + assetNameHex

    // Build, sign, and submit transaction with minting using native script
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

    // Query wallet UTxOs and verify minted asset
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

  it("should handle burning (negative amounts) with submit", { timeout: 60_000 }, async () => {
    const genesisUtxos = shared.genesisUtxos
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not calculated")
    }

    const client = shared.makeClient(7)
    const address = await client.address()

    const assetNameHex = Text.toHex(ASSET_NAME)
    const unit = policyId + assetNameHex

    // Use pre-calculated genesis UTxOs or wallet UTxOs (from prior test)
    let availableUtxos = await client.getWalletUtxos()
    if (availableUtxos.length === 0) {
      // Fall back to genesis UTxOs if Kupo hasn't synced
      const genesisUtxo = genesisUtxos.find((u) => CoreAddress.toBech32(u.address) === CoreAddress.toBech32(address))
      if (!genesisUtxo) {
        throw new Error("Genesis UTxO not found for wallet address")
      }
      availableUtxos = [genesisUtxo]
    }

    // Step 1: First mint tokens
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
      .build({ availableUtxos })

    const mintTx = await mintBuilder.toTransaction()
    expect(mintTx.body.mint).toBeDefined()

    // Submit and wait for confirmation
    const mintSubmitBuilder = await mintBuilder.sign()
    const mintTxHash = await mintSubmitBuilder.submit()
    const mintConfirmed = await client.awaitTx(mintTxHash, 1000)
    expect(mintConfirmed).toBe(true)

    // Step 2: Get the UTxO with minted tokens
    const utxos = await client.getWalletUtxos()
    const utxoWithTokens = utxos.find((u) => {
      const hasToken = CoreAssets.getByUnit(u.assets, unit) > 0n
      return hasToken
    })

    if (!utxoWithTokens) {
      throw new Error("UTxO with minted tokens not found")
    }

    // Step 3: Now burn some of those tokens
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

    // Verify the mint shows negative (burning)
    const mint = burnTx.body.mint!
    let foundBurn = false
    for (const [policyIdKey, assetMap] of mint.map.entries()) {
      if (PolicyId.toHex(policyIdKey) === policyId) {
        for (const [assetName, amount] of assetMap.entries()) {
          if (AssetName.toHex(assetName) === assetNameHex && amount === -500n) {
            foundBurn = true
          }
        }
      }
    }
    expect(foundBurn).toBe(true)

    // Submit burn transaction and verify
    const burnSubmitBuilder = await burnBuilder.sign()
    const burnTxHash = await burnSubmitBuilder.submit()
    expect(TransactionHash.toHex(burnTxHash).length).toBe(64)

    const burnConfirmed = await client.awaitTx(burnTxHash, 1000)
    expect(burnConfirmed).toBe(true)

    // Verify the remaining tokens in wallet
    const utxosAfterBurn = await client.getWalletUtxos()
    let remainingTokenAmount = 0n
    for (const utxo of utxosAfterBurn) {
      remainingTokenAmount += CoreAssets.getByUnit(utxo.assets, unit)
    }
    expect(remainingTokenAmount).toBe(500n)
  })
})
