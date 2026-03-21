/**
 * @fileoverview Devnet tests for Plutus script minting
 *
 * Tests minting with PlutusV3 simple_mint script from the spec project.
 * Uses the simple_mint.simple_mint.mint validator which requires:
 * - MintRedeemer: Constr(0, [idx: Int]) where idx == 1 to succeed
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import * as AssetName from "@evolution-sdk/evolution/AssetName"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Data from "@evolution-sdk/evolution/Data"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as PolicyId from "@evolution-sdk/evolution/PolicyId"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as Text from "@evolution-sdk/evolution/Text"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

const CoreAssets = Cardano.Assets

describe("TxBuilder Plutus Minting (Devnet Submit)", () => {
  // ============================================================================
  // Devnet Setup
  // ============================================================================

  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  /**
   * simple_mint.simple_mint.mint validator from plutus.json
   *
   * This is a PlutusV3 minting policy that succeeds when:
   * - Redeemer is MintRedeemer { idx: 1 }
   *
   * Source: packages/evolution/test/spec/validators/simple_mint.ak
   */
  const SIMPLE_MINT_COMPILED_CODE =
    "59012901010029800aba2aba1aab9faab9eaab9dab9a488888966002646465300130053754003370e90004c02000e601000491112cc004cdc3a400800913259800980218051baa002899192cc004c04000a266e3cdd7180798069baa0044890131008b201c375c601c00260166ea800a2c8048c030c028dd5002c56600266e1d200600489919912cc004c018c030dd500244c8c966002602400513371e6eb8c044c03cdd500324410131008b2020375c6020002601a6ea80122c8058dd698068009806980700098051baa0058acc004c00c012264b30013004300a37540051323259800980800144cdc39bad300f300d3754008900145900e1bad300e001300b37540051640246eb8c030c028dd5002c59008201040203007300800130070013003375400f149a26cac80081"

  // Hash from plutus.json - this is the policy ID
  const SIMPLE_MINT_POLICY_ID_HEX = "5cee358e512c8064024b140fcdb7bc35bb4694d11ccccb7acb182b5c"

  // Helper to create MintRedeemer PlutusData: Constr(0, [Int])
  const makeMintRedeemer = (idx: bigint): Data.Data => Data.constr(0n, [Data.int(idx)])

  // Create PlutusV3 script from compiled CBOR hex
  const makeSimpleMintScript = (): PlutusV3.PlutusV3 => {
    return new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(SIMPLE_MINT_COMPILED_CODE) })
  }

  const simpleMintScript = makeSimpleMintScript()

  // Verify script hash matches expected policy ID
  const scriptHash = ScriptHash.fromScript(simpleMintScript)
  const calculatedPolicyId = ScriptHash.toHex(scriptHash)

  const createTestClient = () =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1444",
        ogmiosUrl: "http://localhost:1339"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0
      }
    })

  beforeAll(async () => {
    // Verify our script hash calculation matches the blueprint
    expect(calculatedPolicyId).toBe(SIMPLE_MINT_POLICY_ID_HEX)

    const testClient = createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: 0 }
    })

    const testAddress = await testClient.address()
    const testAddressHex = CoreAddress.toHex(testAddress)

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [testAddressHex]: 900_000_000_000 }
    }

    // Pre-calculate genesis UTxOs
    genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    devnetCluster = await Cluster.make({
      clusterName: "plutus-minting-test",
      ports: { node: 6002, submit: 9003 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1444, logLevel: "Info" },
      ogmios: { enabled: true, port: 1339, logLevel: "info" }
    })

    await Cluster.start(devnetCluster)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  // ============================================================================
  // Submit Tests
  // ============================================================================

  it("should mint tokens with PlutusV3 simple_mint script", { timeout: 60_000 }, async () => {
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not calculated")
    }

    const client = createTestClient()
    const address = await client.address()

    // Use pre-calculated genesis UTxOs (Kupo may not have synced yet)
    const genesisUtxo = genesisUtxos.find((u) => CoreAddress.toBech32(u.address) === CoreAddress.toBech32(address))
    if (!genesisUtxo) {
      throw new Error("Genesis UTxO not found for wallet address")
    }

    const assetNameHex = Text.toHex("PlutusToken")
    const unit = SIMPLE_MINT_POLICY_ID_HEX + assetNameHex

    // Create redeemer that will pass validation (idx == 1)
    const mintRedeemer = makeMintRedeemer(1n)

    // Build, sign, and submit transaction with Plutus minting
    const signBuilder = await client
      .newTx()
      .attachScript({ script: simpleMintScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: 1000n }),
        redeemer: mintRedeemer
      })
      .payToAddress({
        address,
        assets: CoreAssets.fromRecord({
          lovelace: 3_000_000n,
          [unit]: 1000n
        })
      })
      .build({ availableUtxos: [genesisUtxo] })

    const tx = await signBuilder.toTransaction()
    expect(tx.body.mint).toBeDefined()

    // Verify Plutus script is in witness set
    expect(tx.witnessSet.plutusV3Scripts).toBeDefined()
    expect(tx.witnessSet.plutusV3Scripts!.length).toBe(1)

    // Verify redeemers with evaluated exUnits
    expect(tx.witnessSet.redeemers).toBeDefined()
    expect(tx.witnessSet.redeemers!.size).toBe(1)

    const redeemer = tx.witnessSet.redeemers!.toArray()[0]
    expect(redeemer.tag).toBe("mint")
    expect(redeemer.exUnits.mem).toBeGreaterThan(0n)
    expect(redeemer.exUnits.steps).toBeGreaterThan(0n)

    // Submit transaction
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
        if (PolicyId.toHex(policyIdKey) === SIMPLE_MINT_POLICY_ID_HEX) {
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
    expect(mintedAmount).toBe(1000n)
  })

  it("should mint then burn tokens with PlutusV3 simple_mint script", { timeout: 60_000 }, async () => {
    const client = createTestClient()
    const address = await client.address()

    const assetNameHex = Text.toHex("BurnToken")
    const unit = SIMPLE_MINT_POLICY_ID_HEX + assetNameHex

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
    const mintRedeemer = makeMintRedeemer(1n)

    const mintBuilder = await client
      .newTx()
      .attachScript({ script: simpleMintScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: 1000n }),
        redeemer: mintRedeemer
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
    // eslint-disable-next-line no-console
    console.log(`✓ Submitted Plutus mint tx (for burn test): ${mintTxHash}`)
    const mintConfirmed = await client.awaitTx(mintTxHash, 1000)
    expect(mintConfirmed).toBe(true)

    // Step 2: Get UTxOs after minting - we need one with tokens to spend, and another for collateral
    const utxos = await client.getWalletUtxos()
    const utxoWithTokens = utxos.find((u) => {
      const hasToken = CoreAssets.getByUnit(u.assets, unit) > 0n
      return hasToken
    })

    if (!utxoWithTokens) {
      throw new Error("UTxO with minted tokens not found")
    }

    // Step 3: Now burn some of those tokens
    const burnRedeemer = makeMintRedeemer(1n)

    // Build burn transaction - let client fetch UTxOs for collateral
    const burnBuilder = await client
      .newTx()
      .attachScript({ script: simpleMintScript })
      .collectFrom({ inputs: [utxoWithTokens] })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: -500n }),
        redeemer: burnRedeemer
      })
      .payToAddress({
        address,
        assets: CoreAssets.fromRecord({
          lovelace: 1_500_000n,
          [unit]: 500n
        })
      })
      .build()

    const burnTx = await burnBuilder.toTransaction()
    expect(burnTx.body.mint).toBeDefined()

    // Verify the mint shows negative (burning)
    const mint = burnTx.body.mint!
    let foundBurn = false
    for (const [policyIdKey, assetMap] of mint.map.entries()) {
      if (PolicyId.toHex(policyIdKey) === SIMPLE_MINT_POLICY_ID_HEX) {
        for (const [assetName, amount] of assetMap.entries()) {
          if (AssetName.toHex(assetName) === assetNameHex && amount === -500n) {
            foundBurn = true
          }
        }
      }
    }
    expect(foundBurn).toBe(true)

    // Submit burn transaction
    const burnSubmitBuilder = await burnBuilder.sign()
    const burnTxHash = await burnSubmitBuilder.submit()
    expect(TransactionHash.toHex(burnTxHash).length).toBe(64)

    // eslint-disable-next-line no-console
    console.log(`✓ Submitted Plutus burn tx: ${burnTxHash}`)

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
