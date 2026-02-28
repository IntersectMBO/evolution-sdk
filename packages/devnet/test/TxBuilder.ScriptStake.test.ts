/**
 * Devnet tests for TxBuilder script stake operations.
 *
 * Tests the stake_multivalidator coordination pattern:
 * - spend: validates input index and requires withdrawal presence
 * - withdraw: validates input_indices list, ensures continuity (input_count == output_count)
 * - publish: allows registration/delegation/deregistration of script stake credential
 *
 * Test flow:
 * 1. Register the script stake credential (publish)
 * 2. Fund UTxOs at the script address
 * 3. Build coordination transaction: spend UTxOs + withdraw (0 rewards) + output continuity
 * 4. Deregister the script stake credential (publish)
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Data from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"

import plutusJson from "../../evolution/test/spec/plutus.json"

const getStakeMultiValidator = () => {
  const validator = plutusJson.validators.find((v) => v.title === "stake_multivalidator.stake_multivalidator.spend")

  if (!validator) {
    throw new Error("stake_multivalidator not found in plutus.json")
  }

  return {
    compiledCode: validator.compiledCode,
    hash: validator.hash
  }
}

const { compiledCode: STAKE_MULTI_COMPILED_CODE, hash: STAKE_MULTI_SCRIPT_HASH } = getStakeMultiValidator()

describe("TxBuilder Script Stake Operations", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  // Redeemer types for the stake_multivalidator
  /** PublishRedeemer: Constr(0, [placeholder: Int]) */
  const makePublishRedeemer = (placeholder: bigint = 0n): Data.Data => Data.constr(0n, [Data.int(placeholder)])

  /** WithdrawRedeemer: Constr(0, [input_indices: List<Int>]) */
  const makeWithdrawRedeemer = (inputIndices: Array<bigint>): Data.Data =>
    Data.constr(0n, [Data.list(inputIndices.map(Data.int))])

  /** SpendRedeemer: Int (input index) */
  const makeSpendRedeemer = (inputIndex: bigint): Data.Data => Data.int(inputIndex)

  const makeStakeMultiScript = (): PlutusV3.PlutusV3 =>
    new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(STAKE_MULTI_COMPILED_CODE) })

  const stakeScript = makeStakeMultiScript()
  const scriptHashValue = ScriptHash.fromScript(stakeScript)
  const calculatedScriptHash = ScriptHash.toHex(scriptHashValue)

  // Script stake credential for registration/withdrawal
  // Use the ScriptHash directly - it's already a valid Credential type
  const scriptStakeCredential = scriptHashValue

  // Script payment address (for funding UTxOs)
  const getScriptPaymentAddress = (): Cardano.Address.Address => {
    return CoreAddress.Address.make({
      networkId: 0,
      paymentCredential: scriptHashValue
    })
  }

  const createTestClient = (accountIndex: number = 0) =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1447",
        ogmiosUrl: "http://localhost:1342"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base" // Need Base address to have stake credential for paying fees
      }
    })

  beforeAll(async () => {
    // Verify our script hash calculation matches the blueprint
    expect(calculatedScriptHash).toBe(STAKE_MULTI_SCRIPT_HASH)

    const testClient = createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" }
    })

    const testAddress = await testClient.address()
    const testAddressHex = CoreAddress.toHex(testAddress)

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [testAddressHex]: 500_000_000_000 }
    }

    // Pre-calculate genesis UTxOs
    genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    devnetCluster = await Cluster.make({
      clusterName: "script-stake-test",
      ports: { node: 6005, submit: 9006 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1447, logLevel: "Info" },
      ogmios: { enabled: true, port: 1342, logLevel: "info" }
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

  it("runs full script stake coordination pattern", { timeout: 180_000 }, async () => {
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not calculated")
    }

    const client = createTestClient(0)
    const scriptPaymentAddress = getScriptPaymentAddress()

    // Step 1: Register the script stake credential

    let registerTxHash: string | null = null
    try {
      const registerSignBuilder = await client
        .newTx()
        .registerStake({
          stakeCredential: scriptStakeCredential,
          redeemer: makePublishRedeemer(0n)
        })
        .attachScript({ script: stakeScript })
        .build({ availableUtxos: [...genesisUtxos] })

      const registerSubmitBuilder = await registerSignBuilder.sign()
      registerTxHash = await registerSubmitBuilder.submit()
      const registerConfirmed = await client.awaitTx(registerTxHash, 1000)
      expect(registerConfirmed).toBe(true)
    } catch (e: any) {
      // Check if credential is already registered (code 3145)
      const errorBody = e?.cause?.cause?.cause?.response?.body
      if (!(errorBody?.error?.code === 3145 && errorBody?.error?.message?.includes("re-register"))) {
        throw e
      }
    }

    if (registerTxHash) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    // Step 2: Fund UTxOs at the script address
    const unitDatum = new InlineDatum.InlineDatum({ data: Data.constr(0n, []) })

    const fundSignBuilder = await client
      .newTx()
      .payToAddress({
        address: scriptPaymentAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n),
        datum: unitDatum
      })
      .payToAddress({
        address: scriptPaymentAddress,
        assets: Cardano.Assets.fromLovelace(15_000_000n),
        datum: unitDatum
      })
      .build()

    const fundSubmitBuilder = await fundSignBuilder.sign()
    const fundTxHash = await fundSubmitBuilder.submit()
    const fundConfirmed = await client.awaitTx(fundTxHash, 1000)
    expect(fundConfirmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 3: Coordination transaction (spend + withdraw)
    const scriptUtxos = await client.getUtxos(scriptPaymentAddress)
    expect(scriptUtxos.length).toBeGreaterThanOrEqual(2)

    const utxosToSpend = scriptUtxos.slice(0, 2)

    // Build coordination transaction with deferred redeemers
    let txBuilder = client.newTx()

    // Collect from script UTxOs with self-referencing redeemer
    for (const utxo of utxosToSpend) {
      txBuilder = txBuilder.collectFrom({
        inputs: [utxo],
        redeemer: (indexedInput) => makeSpendRedeemer(BigInt(indexedInput.index))
      })
    }

    txBuilder = txBuilder.attachScript({ script: stakeScript })

    // Withdraw 0 with batch redeemer referencing all input indices
    txBuilder = txBuilder.withdraw({
      stakeCredential: scriptStakeCredential,
      amount: 0n,
      redeemer: {
        all: (indexedInputs) => makeWithdrawRedeemer(indexedInputs.map((inp) => BigInt(inp.index))),
        inputs: utxosToSpend
      }
    })

    // Output continuity: input_count == output_count
    const outputPerUtxo = utxosToSpend.reduce((acc, u) => acc + u.assets.lovelace, 0n) / 2n

    txBuilder = txBuilder
      .payToAddress({
        address: scriptPaymentAddress,
        assets: Cardano.Assets.fromLovelace(outputPerUtxo),
        datum: unitDatum
      })
      .payToAddress({
        address: scriptPaymentAddress,
        assets: Cardano.Assets.fromLovelace(outputPerUtxo),
        datum: unitDatum
      })

    const coordSignBuilder = await txBuilder.build()
    const coordSubmitBuilder = await coordSignBuilder.sign()
    const coordTxHash = await coordSubmitBuilder.submit()
    const coordConfirmed = await client.awaitTx(coordTxHash, 1000)
    expect(coordConfirmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 4: Deregister the script stake credential
    const deregisterSignBuilder = await client
      .newTx()
      .deregisterStake({
        stakeCredential: scriptStakeCredential,
        redeemer: makePublishRedeemer(0n)
      })
      .attachScript({ script: stakeScript })
      .build()

    const deregisterSubmitBuilder = await deregisterSignBuilder.sign()
    const deregisterTxHash = await deregisterSubmitBuilder.submit()
    const deregisterConfirmed = await client.awaitTx(deregisterTxHash, 1000)
    expect(deregisterConfirmed).toBe(true)
  })

  it("captures script failure with labeled redeemers", { timeout: 180_000 }, async () => {
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not calculated")
    }

    const client = createTestClient(0)
    const scriptPaymentAddress = getScriptPaymentAddress()

    // Ensure stake credential is registered
    try {
      const registerSignBuilder = await client
        .newTx()
        .registerStake({ stakeCredential: scriptStakeCredential, redeemer: makePublishRedeemer(0n) })
        .attachScript({ script: stakeScript })
        .build()
      const registerSubmitBuilder = await registerSignBuilder.sign()
      await client.awaitTx(await registerSubmitBuilder.submit(), 1000)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    } catch {
      // Already registered
    }

    // Fund a UTxO at script address
    const unitDatum = new InlineDatum.InlineDatum({ data: Data.constr(0n, []) })
    const fundSignBuilder = await client
      .newTx()
      .payToAddress({
        address: scriptPaymentAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n),
        datum: unitDatum
      })
      .build()
    await client.awaitTx(await (await fundSignBuilder.sign()).submit(), 1000)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Get script UTxOs
    const scriptUtxos = await client.getUtxos(scriptPaymentAddress)
    expect(scriptUtxos.length).toBeGreaterThan(0)
    const utxoToSpend = scriptUtxos[0]!

    // Build transaction with WRONG redeemers and labels for debugging
    const txBuilder = client
      .newTx()
      .collectFrom({
        inputs: [utxoToSpend],
        redeemer: makeSpendRedeemer(999n), // Wrong index
        label: "coordinator-spend-utxo"
      })
      .withdraw({
        stakeCredential: scriptStakeCredential,
        amount: 0n,
        redeemer: makeWithdrawRedeemer([999n]), // Wrong indices
        label: "coordinator-withdrawal"
      })
      .payToAddress({
        address: scriptPaymentAddress,
        assets: Cardano.Assets.fromLovelace(utxoToSpend.assets.lovelace - 1_000_000n),
        datum: unitDatum
      })
      .attachScript({ script: stakeScript })

    // Should fail during evaluation with labeled failures
    let capturedError: any = null
    try {
      await txBuilder.build()
    } catch (e: any) {
      capturedError = e
    }

    expect(capturedError).not.toBeNull()
    const evalError = capturedError?.cause
    expect(evalError?.failures).toBeDefined()
    expect(evalError?.failures?.length).toBeGreaterThan(0)

    // Verify labels are present in failures
    const labels = evalError?.failures?.map((f: any) => f.label)
    expect(labels).toContain("coordinator-withdrawal")
  })
})
