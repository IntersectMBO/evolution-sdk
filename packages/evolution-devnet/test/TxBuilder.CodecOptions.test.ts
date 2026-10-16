/**
 * Devnet test: a transaction built with `codecOptions: CBOR.TX_CANONICAL_OPTIONS`
 * keeps that encoding through sign() and submit(), and the node accepts it.
 *
 * The spend has an inline datum on its input and on a new output, a redeemer
 * with a map and a list, a mint under two Plutus policies and metadata. The
 * canonical options write that data differently from the default, so the
 * node accepts the transaction only when the script data hash and the
 * auxiliary data hash cover the bytes submitted. The node's transaction id
 * must equal the chain txHash.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import * as CostModel from "@evolution-sdk/evolution/CostModel"
import * as Data from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as Redeemers from "@evolution-sdk/evolution/Redeemers"
import * as ScriptDataHash from "@evolution-sdk/evolution/ScriptDataHash"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"

import plutusJson from "../../evolution/test/spec/plutus.json"

const validator = (title: string) => {
  const found = plutusJson.validators.find((v) => v.title === title)
  if (!found) throw new Error(`${title} not found in plutus.json`)
  return new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(found.compiledCode) })
}

describe("BuildOptions.codecOptions (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const spendScript = validator("always_succeed.always_succeed.spend")
  const mintScripts = [validator("simple_mint.simple_mint.mint"), validator("mint.mint_policy.mint")]
  const scriptAddress = Address.Address.make({ networkId: 0, paymentCredential: ScriptHash.fromScript(spendScript) })
  const units = mintScripts.map((s) => ScriptHash.toHex(ScriptHash.fromScript(s)) + "41")

  // Lists and an unsorted map: the default writes the lists indefinite and
  // keeps the map order, the canonical options write definite and sorted
  const datum = Data.constr(0n, [
    Data.map([
      [Data.bytearray("ff"), Data.int(1n)],
      [Data.bytearray("00"), Data.list([Data.int(2n), Data.int(3n)])]
    ]),
    Data.list([Data.int(4n)])
  ])
  const spendRedeemer = Data.constr(0n, [Data.map([[Data.int(1n), Data.int(2n)]]), Data.list([Data.int(3n)])])
  const mintRedeemer = Data.constr(0n, [Data.int(1n)])

  const createTestClient = () => {
    if (!devnetCluster) throw new Error("Cluster not initialized")
    return Client.make(Cluster.getChain(devnetCluster))
      .withKupmios({
        kupoUrl: `http://localhost:${devnetCluster.ports.kupo}`,
        ogmiosUrl: `http://localhost:${devnetCluster.ports.ogmios}`
      })
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" })
  }

  beforeAll(async () => {
    const tempClient = Client.make(preprod).withSeed({ mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" })
    const testAddressHex = Address.toHex(await tempClient.address())

    const genesisConfig: Config.ShelleyGenesis = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [testAddressHex]: 500_000_000_000 }
    }

    genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    devnetCluster = await Cluster.make({
      clusterName: "codec-options-test",
      shelleyGenesis: genesisConfig,
      kupo: { enabled: true, logLevel: "Info" },
      ogmios: { enabled: true, logLevel: "info" }
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

  it("locks an output with an inline datum, built with canonical options", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const signBuilder = await client
      .newTx()
      .payToAddress({
        address: scriptAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n),
        datum: new InlineDatum.InlineDatum({ data: datum })
      })
      .build({ availableUtxos: [...genesisUtxos], codecOptions: CBOR.TX_CANONICAL_OPTIONS })
    const txHash = await (await signBuilder.sign()).submit()
    expect(TransactionHash.toHex(txHash)).toBe(signBuilder.chainResult().txHash)
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(await client.getUtxos(scriptAddress)).toHaveLength(1)
  })

  it("spends it with a map redeemer, mints under two policies and attaches metadata", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const walletAddress = await client.address()
    const [scriptUtxo] = await client.getUtxos(scriptAddress)
    expect(scriptUtxo?.datumOption?._tag).toBe("InlineDatum")

    let builder = client
      .newTx()
      .collectFrom({ inputs: [scriptUtxo!], redeemer: spendRedeemer })
      .attachScript({ script: spendScript })
    for (let i = 0; i < mintScripts.length; i++) {
      builder = builder
        .attachScript({ script: mintScripts[i]! })
        .mintAssets({ assets: Cardano.Assets.fromRecord({ [units[i]!]: 1_000n }), redeemer: mintRedeemer })
    }
    const signBuilder = await builder
      .payToAddress({
        address: walletAddress,
        assets: Cardano.Assets.fromRecord({ lovelace: 3_000_000n, [units[0]!]: 1_000n, [units[1]!]: 1_000n }),
        datum: new InlineDatum.InlineDatum({ data: datum })
      })
      .attachMetadata({ label: 674n, metadata: new Map([["msg", ["canonical", "build"]]]) })
      .build({ codecOptions: CBOR.TX_CANONICAL_OPTIONS })

    // The built transaction is written canonically, and its script data
    // hash covers the canonical redeemers, which the default writes otherwise
    const built = await signBuilder.toTransaction()
    expect(Transaction.toCBORHex(built)).toBe(Transaction.toCBORHex(built, CBOR.TX_CANONICAL_OPTIONS))
    const params = await client.getProtocolParameters()
    const costModels = new CostModel.CostModels({
      PlutusV1: new CostModel.CostModel({ costs: [] }),
      PlutusV2: new CostModel.CostModel({ costs: [] }),
      PlutusV3: new CostModel.CostModel({ costs: Object.values(params.costModels.PlutusV3).map((v) => BigInt(v)) })
    })
    const redeemers = built.witnessSet.redeemers!
    expect(redeemers.size).toBe(3)
    const canonicalHash = ScriptDataHash.toHex(
      Redeemers.toScriptDataHash(redeemers, costModels, undefined, CBOR.TX_CANONICAL_OPTIONS)
    )
    expect(ScriptDataHash.toHex(built.body.scriptDataHash!)).toBe(canonicalHash)
    expect(ScriptDataHash.toHex(Redeemers.toScriptDataHash(redeemers, costModels))).not.toBe(canonicalHash)

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    const chainTxHash = signBuilder.chainResult().txHash
    expect(TransactionHash.toHex(txHash)).toBe(chainTxHash)
    expect(TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(Transaction.toCBORBytes(built))))).toBe(
      chainTxHash
    )
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // The node indexed the outputs under the chain txHash
    const created = (await client.getUtxos(walletAddress)).filter(
      (utxo) => TransactionHash.toHex(utxo.transactionId) === chainTxHash
    )
    expect(created.some((utxo) => Cardano.Assets.getUnits(utxo.assets).includes(units[1]!))).toBe(true)
  })
})
