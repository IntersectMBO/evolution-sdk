import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { createAikenEvaluator } from "@evolution-sdk/aiken-uplc"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Data from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV2 from "@evolution-sdk/evolution/PlutusV2"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import type { TxBuilderConfig } from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import { makeTxBuilder } from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import { KupmiosProvider } from "@evolution-sdk/evolution/sdk/provider/Kupmios"
import { createScalusEvaluator } from "@evolution-sdk/scalus-uplc"
import { Schema } from "effect"

import plutusJson from "../../evolution/test/spec/plutus.json"
import * as Cluster from "../src/Cluster.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

// Alias for Cardano.Assets
const CoreAssets = Cardano.Assets

describe("TxBuilder Script Handling", () => {
  // ============================================================================
  // Devnet Setup (Ogmios for script evaluation)
  // ============================================================================

  let devnetCluster: Cluster.Cluster | undefined
  let kupmiosProvider: KupmiosProvider

  beforeAll(async () => {
    try {
      devnetCluster = await Cluster.make({
        clusterName: "txbuilder-plutus-script-eval",
        ports: {
          node: 5001,
          submit: 9001
        },
        shelleyGenesis: {
          slotLength: 0.02, // 20ms per slot (fast)
          epochLength: 50,
          activeSlotsCoeff: 1.0
        },
        ogmios: {
          enabled: true,
          port: 1337,
          logLevel: "info"
        }
      })

      await Cluster.start(devnetCluster)

      // Wait for Ogmios to be ready
      await new Promise((resolve) => setTimeout(resolve, 2_000))

      // Ogmios serves both HTTP (for JSON-RPC) and WebSocket on the same port
      const ogmiosUrl = "http://localhost:1337"

      // Create provider using local Ogmios
      // Note: Kupo URL is required but not used in these tests (only Ogmios for evaluation)
      kupmiosProvider = new KupmiosProvider(
        "http://localhost:1442", // Kupo (not used)
        ogmiosUrl // Ogmios for script evaluation via HTTP
      )

      // eslint-disable-next-line no-console
      console.log(`✓ Devnet ready - Ogmios: ${ogmiosUrl}`)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to start devnet:", error)
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      try {
        await Cluster.stop(devnetCluster)
        await Cluster.remove(devnetCluster)
        // eslint-disable-next-line no-console
        console.log("✓ Devnet stopped")
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to stop devnet:", error)
      }
    }
  }, 60_000)

  // ============================================================================
  // Test Configuration
  // ============================================================================

  const PROTOCOL_PARAMS = {
    minFeeCoefficient: 44n,
    minFeeConstant: 155_381n,
    coinsPerUtxoByte: 4_310n,
    maxTxSize: 16_384
  }

  const TESTNET_ADDRESSES = [
    "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae",
    "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"
  ] as const

  const CHANGE_ADDRESS = TESTNET_ADDRESSES[0]
  const RECEIVER_ADDRESS = TESTNET_ADDRESSES[1]

  // baseConfig will use kupmiosProvider which is set in beforeAll
  const baseConfig: TxBuilderConfig = {
    get provider() {
      return kupmiosProvider
    }
  }

  // Simple PlutusV2 always-succeeds script (CBOR-wrapped)
  const ALWAYS_SUCCEED_SCRIPT_CBOR = "49480100002221200101"

  const policyId = "c".repeat(56) // Valid policy ID (28 bytes hex = 56 chars)

  // Helper to create PlutusV2 script from CBOR-wrapped hex
  const makePlutusV2Script = (scriptCbor: string): PlutusV2.PlutusV2 => {
    // Unwrap CBOR: First byte 0x49 = byte string of length 9
    const rawScriptHex = scriptCbor.slice(2)
    return new PlutusV2.PlutusV2({ bytes: Bytes.fromHex(rawScriptHex) })
  }

  // Helper to create PlutusV2 script from raw hex bytes (no CBOR wrapping)
  const makePlutusV2ScriptFromHex = (scriptHex: string): PlutusV2.PlutusV2 => {
    return new PlutusV2.PlutusV2({ bytes: Bytes.fromHex(scriptHex) })
  }

  // Helper to create script address from CBOR-wrapped script bytes
  const scriptToAddress = (scriptCbor: string): string => {
    const coreScript = makePlutusV2Script(scriptCbor)
    const scriptHash = ScriptHash.fromScript(coreScript)
    const addressStruct = CoreAddress.Address.make({
      networkId: 0,
      paymentCredential: scriptHash
    })
    return Schema.encodeSync(CoreAddress.FromBech32)(addressStruct)
  }

  it("should build transaction collecting from PlutusV2 script UTxO", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create funding UTxO
    const fundingUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [fundingUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify transaction structure
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2) // Payment + change

    // Verify script witnesses
    expect(tx.witnessSet.plutusV2Scripts).toBeDefined()
    expect(tx.witnessSet.plutusV2Scripts!.length).toBe(1)

    // Verify redeemers with evaluated exUnits
    expect(tx.witnessSet.redeemers).toBeDefined()
    expect(tx.witnessSet.redeemers!.size).toBe(1)

    const redeemer = tx.witnessSet.redeemers!.toArray()[0]
    expect(redeemer.tag).toBe("spend")
    expect(redeemer.exUnits.mem).toBeGreaterThan(0n) // mem > 0
    expect(redeemer.exUnits.steps).toBeGreaterThan(0n) // steps > 0
  })

  it("should build transaction with Aiken WASM evaluator", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create funding UTxO
    const fundingUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Build with Aiken evaluator and debug enabled
    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [fundingUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      evaluator: createAikenEvaluator
    })

    const tx = await signBuilder.toTransaction()

    // Verify transaction structure
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2) // Payment + change

    // Verify script witnesses
    expect(tx.witnessSet.plutusV2Scripts).toBeDefined()
    expect(tx.witnessSet.plutusV2Scripts!.length).toBe(1)

    // Verify redeemers with evaluated exUnits
    expect(tx.witnessSet.redeemers).toBeDefined()
    expect(tx.witnessSet.redeemers!.size).toBe(1)

    const redeemer = tx.witnessSet.redeemers!.toArray()[0]
    expect(redeemer.tag).toBe("spend")
    expect(redeemer.exUnits.mem).toBe(1100n)
    expect(redeemer.exUnits.steps).toBe(160100n)
  })

  it("should build transaction with Scalus evaluator", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create funding UTxO
    const fundingUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Build with Scalus evaluator and debug enabled
    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [fundingUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      evaluator: createScalusEvaluator,
      debug: true // Enable debug logging
    })

    const tx = await signBuilder.toTransaction()

    // Verify transaction structure
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2) // Payment + change

    // Verify script witnesses
    expect(tx.witnessSet.plutusV2Scripts).toBeDefined()
    expect(tx.witnessSet.plutusV2Scripts!.length).toBe(1)

    // Verify redeemers with evaluated exUnits
    expect(tx.witnessSet.redeemers).toBeDefined()
    expect(tx.witnessSet.redeemers!.size).toBe(1)

    const redeemer = tx.witnessSet.redeemers!.toArray()[0]
    expect(redeemer.tag).toBe("spend")
    expect(redeemer.exUnits.mem).toBe(1100n)
    expect(redeemer.exUnits.steps).toBe(160100n)
  })

  it("should handle collateral inputs with multiassets and return excess to user as collateral return", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    const multiAssetUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n,
      nativeAssets: {
        // 10 different native assets (worst case for estimation accuracy)
        [`${policyId}544f4b454e3031`]: 100n, // "TOKEN01"
        [`${policyId}544f4b454e3032`]: 100n, // "TOKEN02"
        [`${policyId}544f4b454e3033`]: 100n, // "TOKEN03"
        [`${policyId}544f4b454e3034`]: 100n, // "TOKEN04"
        [`${policyId}544f4b454e3035`]: 100n, // "TOKEN05"
        [`${policyId}544f4b454e3036`]: 100n, // "TOKEN06"
        [`${policyId}544f4b454e3037`]: 100n, // "TOKEN07"
        [`${policyId}544f4b454e3038`]: 100n, // "TOKEN08"
        [`${policyId}544f4b454e3039`]: 100n, // "TOKEN09"
        [`${policyId}544f4b454e3130`]: 100n // "TOKEN10"
      }
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [multiAssetUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify collateral inputs were selected
    expect(tx.body.collateralInputs).toBeDefined()
    expect(tx.body.collateralInputs!.length).toBe(1)

    const collateralInput = tx.body.collateralInputs![0]
    expect(collateralInput.transactionId.hash).toEqual(new Uint8Array(32).fill(187)) // "b".repeat(64) = 0xBB repeated
    expect(collateralInput.index).toBe(0n)

    // Verify totalCollateral is set (150% of adjusted fee)
    expect(tx.body.totalCollateral).toBeDefined()
    expect(tx.body.totalCollateral).toBeGreaterThan(0n)

    // Verify collateralReturn exists and contains tokens
    expect(tx.body.collateralReturn).toBeDefined()
    const collateralReturn = tx.body.collateralReturn!

    // Verify lovelace amount in collateralReturn
    expect(collateralReturn.assets.multiAsset).toBeDefined()
    if (collateralReturn.assets.multiAsset !== undefined) {
      expect(collateralReturn.assets.lovelace).toBeGreaterThan(0n)

      // Count total number of tokens across all policies
      let totalTokens = 0
      for (const [_policyId, assetMap] of collateralReturn.assets.multiAsset.map.entries()) {
        totalTokens += assetMap.size
      }

      // Verify all 10 tokens are returned (regardless of how they're organized)
      expect(totalTokens).toBe(10)

      // Verify collateralReturn meets minUTxO requirement (with tokens, should be > 1.5 ADA)
      expect(collateralReturn.assets.lovelace).toBeGreaterThanOrEqual(1_500_000n)
    }
  })
  it("should fail when collateral return is below minimum UTxO", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create a collateral UTxO with tokens
    // With setCollateral: 1_500_000n (1.5 ADA):
    // - Return will be: 1.5 ADA - ~0.26 ADA (totalCollateral) = ~1.24 ADA
    // - Need minUTxO > 1.24 ADA to trigger failure
    // - Add more tokens to increase minUTxO above 1.24 ADA
    const collateralUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 1_500_000n, // 1.5 ADA - matches setCollateral target
      nativeAssets: {
        // Add many tokens to increase minUTxO requirement above 1.24 ADA
        [`${policyId}544f4b454e3031`]: 100n,
        [`${policyId}544f4b454e3032`]: 100n,
        [`${policyId}544f4b454e3033`]: 100n,
        [`${policyId}544f4b454e3034`]: 100n,
        [`${policyId}544f4b454e3035`]: 100n,
        [`${policyId}544f4b454e3036`]: 100n,
        [`${policyId}544f4b454e3037`]: 100n
      }
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Build with lower setCollateral to trigger minUTxO failure
    await expect(
      builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [collateralUtxo],
        protocolParameters: PROTOCOL_PARAMS,
        setCollateral: 1_500_000n // Lower target so return (1.5 - 0.26 = 1.24 ADA) < minUTxO with 7 tokens
      })
    ).rejects.toThrow(/collateral return.*below.*minimum UTxO/i)
  })

  it("should fail when available utxos are insufficient to cover collateral", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create collateral UTxOs that are too small (total < 5 ADA default target)
    // With default setCollateral of 5 ADA, these won't be enough
    const smallUtxo1 = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n // 2 ADA
    })

    const smallUtxo2 = createCoreTestUtxo({
      transactionId: "c".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 2_500_000n // 2.5 ADA
    })

    // Total available: 4.5 ADA, but need 5 ADA

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Should fail because total collateral available (4.5 ADA) < target (5 ADA)
    await expect(
      builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [smallUtxo1, smallUtxo2],
        protocolParameters: PROTOCOL_PARAMS
        // Using default setCollateral of 5 ADA
      })
    ).rejects.toThrow(/Insufficient collateral available.*Need 5000000.*but only found 4500000/i)
  })

  it("should not use utxos with reference script as collateral", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create UTxO WITH reference script (should be excluded from collateral)
    const utxoWithRefScript = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n,
      scriptRef: alwaysSucceedsScript // Has reference script - should NOT be used as collateral
    })

    // Create UTxO WITHOUT reference script (should be used as collateral)
    const utxoWithoutRefScript = createCoreTestUtxo({
      transactionId: "c".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 8_000_000n
      // No scriptRef - can be used as collateral
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [utxoWithRefScript, utxoWithoutRefScript],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify collateral inputs were selected
    expect(tx.body.collateralInputs).toBeDefined()
    expect(tx.body.collateralInputs!.length).toBe(1)

    const collateralInput = tx.body.collateralInputs![0]

    // Verify that the collateral input is the one WITHOUT reference script
    // UTxO "c" (without ref script) should be selected, not "b" (with ref script)
    expect(collateralInput.transactionId.hash).toEqual(new Uint8Array(32).fill(204)) // "c".repeat(64) = 0xCC repeated
    expect(collateralInput.index).toBe(0n)

    // Verify it's NOT the UTxO with reference script
    expect(collateralInput.transactionId.hash).not.toEqual(new Uint8Array(32).fill(187)) // "b".repeat(64) = 0xBB
  })

  it("should select collateral before creating change output (largest-first, exact match)", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create funding UTxO (smaller amount to test largest-first selection)
    const tightFundingUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 3_200_000n // 3.2 ADA - smaller than collateral UTxO
    })

    // Create collateral UTxO (exactly matches 5 ADA target)
    const collateralUtxo = createCoreTestUtxo({
      transactionId: "c".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 5_000_000n // 5 ADA - exact match with target
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n) // 2 ADA payment
      })

    // Test phase reordering: Collateral runs BEFORE ChangeCreation
    // This ensures:
    // 1. Collateral is added to transaction structure first
    // 2. FeeCalculation includes collateral size in fee calculation
    // 3. Change is created with correct fee from the start (no imbalance)
    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [tightFundingUtxo, collateralUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify transaction was built successfully
    expect(tx.body.inputs.length).toBe(1)
    expect(tx.body.collateralInputs).toBeDefined()

    // Test largest-first selection: With 2 available UTxOs (3.2 ADA, 5 ADA):
    // - Candidates sorted: pure ADA first, then largest first
    // - Selects 5 ADA UTxO (already >= 5 ADA target, stops immediately)
    // Result: Only 1 collateral input selected (not 2)
    expect(tx.body.collateralInputs!.length).toBe(1)

    // Extract the actual amounts from the transaction
    const fee = tx.body.fee

    // Get change output (should be the last output)
    const changeOutput = tx.body.outputs[tx.body.outputs.length - 1]
    const changeAmount = changeOutput.assets.lovelace

    // Verify transaction is perfectly balanced
    // With phase reordering (Collateral BEFORE ChangeCreation):
    // - Collateral added to transaction first
    // - FeeCalculation includes collateral size (188 bytes)
    // - Change created with correct fee from the start
    const expectedChange = CoreAssets.lovelaceOf(scriptUtxo.assets) - 2_000_000n - fee

    expect(changeAmount).toBe(expectedChange)

    // Verify the fee is reasonable and includes collateral overhead
    expect(fee).toBeGreaterThan(163_000n) // Base fee ~163k
    expect(fee).toBeLessThan(180_000n) // But still reasonable
  })

  it("should create collateral return when leftover ADA exists", async () => {
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)

    // Create script UTxO with inline datum
    const ownerPubKeyHash = "00000000000000000000000000000000000000000000000000000000"
    const datum = Data.constr(0n, [Data.bytearray(ownerPubKeyHash)])

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: datum })
    })

    // Create collateral UTxO with MORE than 5 ADA (should create return)
    const collateralUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n // 10 ADA - exceeds 5 ADA target
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Test collateral return creation
    // - Available: 10 ADA
    // - Target: 5 ADA
    // - Expected: 5 ADA return output should be created
    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [collateralUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify collateral was selected
    expect(tx.body.collateralInputs).toBeDefined()
    expect(tx.body.collateralInputs!.length).toBe(1)

    // Verify totalCollateral is set to 5 ADA
    expect(tx.body.totalCollateral).toBe(5_000_000n)

    // Verify collateral return exists (5 ADA leftover)
    expect(tx.body.collateralReturn).toBeDefined()
    const collateralReturn = tx.body.collateralReturn!

    // Verify return amount is the leftover (10 ADA - 5 ADA = 5 ADA)
    expect(collateralReturn.assets.lovelace).toBe(5_000_000n)
    // Should be pure ADA (no tokens)
    if (collateralReturn.assets.multiAsset !== undefined) {
      expect(collateralReturn.assets.multiAsset.map.size).toBe(0)
    }

    // Verify collateral return address is the change address
    expect(collateralReturn.address).toBeDefined()
  })

  // ============================================================================
  // Reference Script Fee Tier Pricing Tests
  // ============================================================================

  it("should calculate correct reference script fee for Tier 1 (0-25KB)", async () => {
    // Create a script UTxO with a 10KB reference script
    const scriptSize = 10_000 // 10KB in bytes
    const scriptHex = "48".repeat(scriptSize) // Each byte as hex (2 chars)
    const referenceScript = makePlutusV2ScriptFromHex(scriptHex)

    // Create UTxO with reference script
    const refScriptUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n,
      scriptRef: referenceScript
    })

    // Create regular UTxO for spending
    const spendUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    const builder = makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [refScriptUtxo] })
      .collectFrom({ inputs: [spendUtxo] })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify reference inputs are set
    expect(tx.body.referenceInputs).toBeDefined()
    expect(tx.body.referenceInputs!.length).toBe(1)

    // Calculate expected fee:
    // - Base fee for transaction
    // - Reference script fee: 10,000 bytes * 15 lovelace/byte = 150,000 lovelace
    const expectedMinRefScriptFee = 150_000n

    // Fee should be at least base fee + reference script fee
    // We can't calculate exact base fee, but we know ref script fee is included
    expect(tx.body.fee).toBeGreaterThan(expectedMinRefScriptFee)
  })

  it("should calculate correct reference script fee for Tier 2 (25-50KB)", async () => {
    // Create a script UTxO with a 30KB reference script
    const scriptSize = 30_000 // 30KB in bytes
    const scriptHex = "48".repeat(scriptSize)
    const referenceScript = makePlutusV2ScriptFromHex(scriptHex)

    const refScriptUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n,
      scriptRef: referenceScript
    })

    const spendUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    const builder = makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [refScriptUtxo] })
      .collectFrom({ inputs: [spendUtxo] })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.referenceInputs).toBeDefined()
    expect(tx.body.referenceInputs!.length).toBe(1)

    // Calculate expected reference script fee:
    // Tier 1: 25,000 bytes * 15 lovelace/byte = 375,000
    // Tier 2: 5,000 bytes * 25 lovelace/byte = 125,000
    // Total: 500,000 lovelace
    const expectedMinRefScriptFee = 500_000n

    expect(tx.body.fee).toBeGreaterThan(expectedMinRefScriptFee)
  })

  it("should calculate correct reference script fee for Tier 3 (50-200KB)", async () => {
    // Create a script UTxO with a 60KB reference script
    const scriptSize = 60_000 // 60KB in bytes
    const scriptHex = "48".repeat(scriptSize)
    const referenceScript = makePlutusV2ScriptFromHex(scriptHex)

    const refScriptUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n,
      scriptRef: referenceScript
    })

    const spendUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    const builder = makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [refScriptUtxo] })
      .collectFrom({ inputs: [spendUtxo] })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.referenceInputs).toBeDefined()
    expect(tx.body.referenceInputs!.length).toBe(1)

    // Calculate expected reference script fee:
    // Tier 1: 25,000 bytes * 15 lovelace/byte = 375,000
    // Tier 2: 25,000 bytes * 25 lovelace/byte = 625,000
    // Tier 3: 10,000 bytes * 100 lovelace/byte = 1,000,000
    // Total: 2,000,000 lovelace
    const expectedMinRefScriptFee = 2_000_000n

    expect(tx.body.fee).toBeGreaterThan(expectedMinRefScriptFee)
  })

  it("should reject reference script exceeding 200KB maximum", async () => {
    // Create a script UTxO with a 250KB reference script (exceeds limit)
    const scriptSize = 250_000 // 250KB in bytes
    const scriptHex = "48".repeat(scriptSize)
    const referenceScript = makePlutusV2ScriptFromHex(scriptHex)

    const refScriptUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n,
      scriptRef: referenceScript
    })

    const spendUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    const builder = makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [refScriptUtxo] })
      .collectFrom({ inputs: [spendUtxo] })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Should fail during build due to 200KB limit
    await expect(
      builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [],
        protocolParameters: PROTOCOL_PARAMS
      })
    ).rejects.toThrow(/exceeds maximum limit of 200,000 bytes/)
  })

  it("should handle multiple reference inputs and sum their fees", async () => {
    // Create two reference script UTxOs
    const script1Size = 15_000 // 15KB
    const script2Size = 20_000 // 20KB

    const referenceScript1 = makePlutusV2ScriptFromHex("48".repeat(script1Size))

    const referenceScript2 = makePlutusV2ScriptFromHex("48".repeat(script2Size))

    const refScriptUtxo1 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n,
      scriptRef: referenceScript1
    })

    const refScriptUtxo2 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n,
      scriptRef: referenceScript2
    })

    const spendUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    const builder = makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [refScriptUtxo1, refScriptUtxo2] })
      .collectFrom({ inputs: [spendUtxo] })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.referenceInputs).toBeDefined()
    expect(tx.body.referenceInputs!.length).toBe(2)

    // Calculate expected reference script fee:
    // Combined size: 35,000 bytes
    // Tier 1: 25,000 bytes * 15 lovelace/byte = 375,000
    // Tier 2: 10,000 bytes * 25 lovelace/byte = 250,000
    // Total: 625,000 lovelace
    const expectedMinRefScriptFee = 625_000n

    expect(tx.body.fee).toBeGreaterThan(expectedMinRefScriptFee)
  })

  it("should not charge reference script fee when no scriptRef present", async () => {
    // Create UTxO WITHOUT reference script
    const refUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 3_000_000n
      // No scriptRef
    })

    const spendUtxo = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    const builder = makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [refUtxo] })
      .collectFrom({ inputs: [spendUtxo] })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.referenceInputs).toBeDefined()
    expect(tx.body.referenceInputs!.length).toBe(1)

    // Fee should only be the base transaction fee (no reference script fee)
    // We can't assert exact amount, but it should be relatively small
    expect(tx.body.fee).toBeLessThan(500_000n) // Base fee should be under 500k
  })

  // ============================================================================
  // Collateral Input Limit Tests
  // ============================================================================

  it("should enforce maximum 3 collateral inputs even when more would help", async () => {
    // Create script UTxO that needs collateral
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)

    const scriptUtxo = createCoreTestUtxo({
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: Data.constr(0n, []) })
    })

    // Create 4 collateral candidates:
    // - Three large ones (2 ADA each = 6 ADA total, which is sufficient)
    // - One small one (1 ADA)
    // The builder should pick only the 3 largest (protocol limit)
    const collateralUtxo1 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n,
      transactionId: "c".repeat(64),
      index: 0
    })

    const collateralUtxo2 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n,
      transactionId: "c".repeat(64),
      index: 1
    })

    const collateralUtxo3 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n,
      transactionId: "c".repeat(64),
      index: 2
    })

    const collateralUtxo4 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 1_000_000n,
      transactionId: "c".repeat(64),
      index: 3
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [collateralUtxo1, collateralUtxo2, collateralUtxo3, collateralUtxo4],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify collateral was selected
    expect(tx.body.collateralInputs).toBeDefined()

    // CRITICAL: Must select exactly 3 inputs (protocol limit), NOT 4
    // Even though 4 UTxOs are available, protocol forbids more than 3
    expect(tx.body.collateralInputs!.length).toBe(3)

    // Verify total collateral is 5 ADA (the target)
    expect(tx.body.totalCollateral).toBe(5_000_000n)

    // Should have collateral return of 1 ADA (6 ADA input - 5 ADA target)
    expect(tx.body.collateralReturn).toBeDefined()
    const collateralReturn = tx.body.collateralReturn!
    expect(collateralReturn.address).toBeDefined()
    expect(collateralReturn.assets.lovelace).toBe(1_000_000n)
  })

  it("should successfully select collateral when exactly 3 inputs are sufficient", async () => {
    // Create script UTxO that needs collateral
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)

    const scriptUtxo = createCoreTestUtxo({
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: Data.constr(0n, []) })
    })

    // Create 3 collateral candidates (each with 2 ADA, total 6 ADA > 5 ADA target)
    const collateralUtxo1 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n,
      transactionId: "d".repeat(64),
      index: 0
    })

    const collateralUtxo2 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n,
      transactionId: "d".repeat(64),
      index: 1
    })

    const collateralUtxo3 = createCoreTestUtxo({
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n,
      transactionId: "d".repeat(64),
      index: 2
    })

    // Create redeemer
    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    const signBuilder = await builder.build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [collateralUtxo1, collateralUtxo2, collateralUtxo3],
      protocolParameters: PROTOCOL_PARAMS,
      passAdditionalUtxos: true // Required for synthetic UTxOs not on chain
    })

    const tx = await signBuilder.toTransaction()

    // Verify collateral was selected
    expect(tx.body.collateralInputs).toBeDefined()
    expect(tx.body.collateralInputs!.length).toBe(3)

    // Verify total collateral is 5 ADA
    expect(tx.body.totalCollateral).toBe(5_000_000n)

    // Verify collateral return exists (6 ADA - 5 ADA = 1 ADA leftover)
    expect(tx.body.collateralReturn).toBeDefined()
    const collateralReturn = tx.body.collateralReturn!

    expect(collateralReturn.assets.lovelace).toBe(1_000_000n) // 1 ADA return
  })

  it("should fail when max 3 collateral inputs are insufficient to cover target", async () => {
    // Create script UTxO that needs collateral
    const scriptAddress = scriptToAddress(ALWAYS_SUCCEED_SCRIPT_CBOR)
    const alwaysSucceedsScript = makePlutusV2Script(ALWAYS_SUCCEED_SCRIPT_CBOR)

    const scriptUtxo = createCoreTestUtxo({
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: Data.constr(0n, []) })
    })

    // Create 5 small collateral UTxOs (1.5 ADA each)
    // Even though 4 would be enough (6 ADA), protocol limits us to 3
    // 3 × 1.5 ADA = 4.5 ADA < 5 ADA target
    const collateralUtxos = Array.from({ length: 5 }, (_, i) =>
      createCoreTestUtxo({
        address: CHANGE_ADDRESS,
        lovelace: 1_500_000n,
        transactionId: "e".repeat(64),
        index: i
      })
    )

    const redeemerData = Data.constr(0n, [Data.bytearray("48656c6c6f2c20576f726c6421")])

    const builder = makeTxBuilder(baseConfig)
      .collectFrom({
        inputs: [scriptUtxo],
        redeemer: redeemerData
      })
      .attachScript({ script: alwaysSucceedsScript })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })

    // Should fail: max 3 inputs selected = 4.5 ADA < 5 ADA target
    await expect(
      builder.build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: collateralUtxos,
        protocolParameters: PROTOCOL_PARAMS
      })
    ).rejects.toThrow(/Insufficient collateral available.*Need 5000000.*but only found 4500000/i)
  })

  it("should build a transaction with a >64-byte redeemer field using bounded_bytes encoding", async () => {
    const alwaysSucceedValidator = plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")!
    const alwaysSucceedV3 = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(alwaysSucceedValidator.compiledCode) })
    const scriptHash = ScriptHash.fromScript(alwaysSucceedV3)
    const scriptAddress = Schema.encodeSync(CoreAddress.FromBech32)(
      CoreAddress.Address.make({ networkId: 0, paymentCredential: scriptHash })
    )

    const scriptUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: scriptAddress,
      lovelace: 5_000_000n,
      datumOption: new InlineDatum.InlineDatum({ data: Data.constr(0n, []) })
    })

    const fundingUtxo = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 10_000_000n
    })

    // 100-byte payload — exceeds the 64-byte bounded_bytes chunk size
    const largePayload = new Uint8Array(100).fill(0xaa)

    const signBuilder = await makeTxBuilder(baseConfig)
      .collectFrom({ inputs: [scriptUtxo], redeemer: Data.constr(0n, [largePayload]) })
      .attachScript({ script: alwaysSucceedV3 })
      .payToAddress({
        address: CoreAddress.fromBech32(RECEIVER_ADDRESS),
        assets: CoreAssets.fromLovelace(4_000_000n)
      })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [fundingUtxo],
        protocolParameters: PROTOCOL_PARAMS,
        passAdditionalUtxos: true
      })

    const tx = await signBuilder.toTransaction()

    expect(tx.witnessSet.redeemers).toBeDefined()
    expect(tx.witnessSet.redeemers!.size).toBe(1)
    const redeemer = tx.witnessSet.redeemers!.toArray()[0]
    expect(redeemer.tag).toBe("spend")
    expect(redeemer.exUnits.mem).toBeGreaterThan(0n)
    expect(redeemer.exUnits.steps).toBeGreaterThan(0n)
  })
})
