/**
 * Devnet tests for RedeemerBuilder deferred redeemer resolution.
 *
 * Uses mint_multi_validator which validates that redeemer.value = datum.counter + input_index.
 * This requires reading the datum from each UTxO and combining it with the resolved index.
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
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as PolicyId from "@evolution-sdk/evolution/PolicyId"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as Text from "@evolution-sdk/evolution/Text"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { Schema } from "effect"

import plutusJson from "../../evolution/test/spec/plutus.json"

const CoreAssets = Cardano.Assets

const getMintMultiValidator = () => {
  const validator = plutusJson.validators.find((v) => v.title === "mint_multi_validator.mint_multi_validator.spend")

  if (!validator) {
    throw new Error("mint_multi_validator not found in plutus.json")
  }

  return {
    compiledCode: validator.compiledCode,
    hash: validator.hash
  }
}

const { compiledCode: MINT_MULTI_COMPILED_CODE, hash: MINT_MULTI_POLICY_ID_HEX } = getMintMultiValidator()

describe("TxBuilder RedeemerBuilder", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  /** SpendRedeemer: Constr(0, [value: Int]) where value = datum.counter + input_index */
  const makeSpendRedeemer = (value: bigint): Data.Data => Data.constr(0n, [Data.int(value)])

  /** MintRedeemer: Constr(0, [entries: List<(Int, Int)>]) */
  const makeMintRedeemer = (entries: Array<[bigint, bigint]>): Data.Data =>
    Data.constr(0n, [Data.list(entries.map(([idx, val]) => Data.list([Data.int(idx), Data.int(val)])))])

  /** CounterDatum: Constr(0, [counter: Int]) */
  const makeCounterDatum = (counter: bigint): Data.Data => Data.constr(0n, [Data.int(counter)])

  /** Parse counter value from UTxO inline datum */
  const parseCounterDatum = (utxo: Cardano.UTxO.UTxO): bigint => {
    const datumOption = utxo.datumOption
    if (!datumOption || datumOption._tag !== "InlineDatum") {
      throw new Error("UTxO has no inline datum")
    }
    const datumData = datumOption.data
    if (Data.isConstr(datumData) && datumData.fields.length > 0) {
      const counterField = datumData.fields[0]
      if (Data.isInt(counterField)) {
        return counterField
      }
    }
    throw new Error("Unexpected datum structure")
  }

  const makeMintMultiScript = (): PlutusV3.PlutusV3 =>
    new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(MINT_MULTI_COMPILED_CODE) })

  const mintMultiScript = makeMintMultiScript()
  const scriptHashValue = ScriptHash.fromScript(mintMultiScript)
  const calculatedPolicyId = ScriptHash.toHex(scriptHashValue)

  const createTestClient = () =>
    createClient({
      network: 0,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1445",
        ogmiosUrl: "http://localhost:1340"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0
      }
    })

  beforeAll(async () => {
    // Verify our script hash calculation matches the blueprint
    expect(calculatedPolicyId).toBe(MINT_MULTI_POLICY_ID_HEX)

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
      clusterName: "redeemer-builder-test",
      ports: { node: 6003, submit: 9004 },
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, port: 1445, logLevel: "Info" },
      ogmios: { enabled: true, port: 1340, logLevel: "info" }
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

  it("resolves redeemers using datum + index from multiple script UTxOs", { timeout: 120_000 }, async () => {
    if (genesisUtxos.length === 0) {
      throw new Error("Genesis UTxOs not calculated")
    }

    const client = createTestClient()
    const walletAddress = await client.address()

    // Use pre-calculated genesis UTxOs
    const genesisUtxo = genesisUtxos.find(
      (u) => CoreAddress.toBech32(u.address) === CoreAddress.toBech32(walletAddress)
    )
    if (!genesisUtxo) {
      throw new Error("Genesis UTxO not found for wallet address")
    }

    // Use unique token name with timestamp to avoid UTxO accumulation from retries
    const timestamp = Date.now().toString(36)
    const assetNameHex = Text.toHex(`Batch${timestamp}`)
    const unit = MINT_MULTI_POLICY_ID_HEX + assetNameHex

    // Create the script address
    const scriptAddressStruct = CoreAddress.Address.make({
      networkId: 0,
      paymentCredential: scriptHashValue
    })
    const scriptAddress = Schema.encodeSync(CoreAddress.FromBech32)(scriptAddressStruct)

    // Step 1: Mint tokens to 3 script UTxOs with different counter datums (10, 20, 30)
    const setupMintRedeemer = makeMintRedeemer([])
    const datum1 = makeCounterDatum(10n)
    const datum2 = makeCounterDatum(20n)
    const datum3 = makeCounterDatum(30n)

    const setupSignBuilder = await client
      .newTx()
      .attachScript({ script: mintMultiScript })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: 300n }),
        redeemer: setupMintRedeemer
      })
      .payToAddress({
        address: CoreAddress.fromBech32(scriptAddress),
        assets: CoreAssets.fromRecord({ lovelace: 3_000_000n, [unit]: 100n }),
        datum: new InlineDatum.InlineDatum({ data: datum1 })
      })
      .payToAddress({
        address: CoreAddress.fromBech32(scriptAddress),
        assets: CoreAssets.fromRecord({ lovelace: 3_000_000n, [unit]: 100n }),
        datum: new InlineDatum.InlineDatum({ data: datum2 })
      })
      .payToAddress({
        address: CoreAddress.fromBech32(scriptAddress),
        assets: CoreAssets.fromRecord({ lovelace: 3_000_000n, [unit]: 100n }),
        datum: new InlineDatum.InlineDatum({ data: datum3 })
      })
      .build({ availableUtxos: [genesisUtxo] })

    const setupSubmitBuilder = await setupSignBuilder.sign()
    const setupTxHash = await setupSubmitBuilder.submit()
    const setupConfirmed = await client.awaitTx(setupTxHash, 1000)
    expect(setupConfirmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Step 2: Spend all 3 script UTxOs using deferred redeemer
    const allScriptUtxos = await client.getUtxos(CoreAddress.fromBech32(scriptAddress))
    const scriptUtxos = allScriptUtxos.filter((u) => {
      if (!u.assets.multiAsset) return false
      for (const [policyIdKey, assetMap] of u.assets.multiAsset.map.entries()) {
        if (PolicyId.toHex(policyIdKey) === MINT_MULTI_POLICY_ID_HEX) {
          for (const [name] of assetMap.entries()) {
            if (AssetName.toHex(name) === assetNameHex) {
              return true
            }
          }
        }
      }
      return false
    })
    expect(scriptUtxos.length).toBe(3)

    const walletUtxos = await client.getWalletUtxos()

    // Key test: SelfRedeemerFn reads datum.counter from UTxO and adds resolved index
    const spendSignBuilder = await client
      .newTx()
      .attachScript({ script: mintMultiScript })
      .collectFrom({
        inputs: scriptUtxos,
        redeemer: ({ index, utxo }: { index: number; utxo: Cardano.UTxO.UTxO }): Data.Data => {
          const datumCounter = parseCounterDatum(utxo)
          return makeSpendRedeemer(datumCounter + BigInt(index))
        }
      })
      .mintAssets({
        assets: CoreAssets.fromRecord({ [unit]: -300n }),
        redeemer: {
          all: (inputs: ReadonlyArray<{ index: number; utxo: Cardano.UTxO.UTxO }>): Data.Data => {
            const entries: Array<[bigint, bigint]> = inputs.map((input) => {
              const datumCounter = parseCounterDatum(input.utxo)
              return [BigInt(input.index), datumCounter + BigInt(input.index)]
            })
            return makeMintRedeemer(entries)
          },
          inputs: scriptUtxos
        }
      })
      .payToAddress({
        address: walletAddress,
        assets: CoreAssets.fromRecord({ lovelace: 7_000_000n })
      })
      .build({ availableUtxos: walletUtxos })

    const spendTx = await spendSignBuilder.toTransaction()

    // Verify we have 4 redeemers: 3 spends + 1 mint
    expect(spendTx.witnessSet.redeemers).toBeDefined()
    expect(spendTx.witnessSet.redeemers!.size).toBe(4)

    const allRedeemers = spendTx.witnessSet.redeemers!.toArray()
    const spendRedeemers = allRedeemers.filter((r) => r.tag === "spend")
    const mintRedeemers = allRedeemers.filter((r) => r.tag === "mint")

    expect(spendRedeemers.length).toBe(3)
    expect(mintRedeemers.length).toBe(1)

    const spendSubmitBuilder = await spendSignBuilder.sign()
    const spendTxHash = await spendSubmitBuilder.submit()
    expect(TransactionHash.toHex(spendTxHash).length).toBe(64)

    const spendConfirmed = await client.awaitTx(spendTxHash, 1000)
    expect(spendConfirmed).toBe(true)

    // Verify all tokens were burned - wallet should have no BatchTokens
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const finalUtxos = await client.getWalletUtxos()
    let finalTokenAmount = 0n

    for (const utxo of finalUtxos) {
      if (!utxo.assets.multiAsset) continue
      for (const [policyIdKey, assetMap] of utxo.assets.multiAsset.map.entries()) {
        if (PolicyId.toHex(policyIdKey) === MINT_MULTI_POLICY_ID_HEX) {
          for (const [assetName, amount] of assetMap.entries()) {
            if (AssetName.toHex(assetName) === assetNameHex) {
              finalTokenAmount += amount
            }
          }
        }
      }
    }

    expect(finalTokenAmount).toBe(0n)
  })
})
