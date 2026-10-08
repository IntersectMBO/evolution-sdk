/**
 * Devnet test: a witness datum, its datum hash and the script data hash agree
 * on the datum bytes, and the redeemer data the builder writes in the data
 * default is accepted.
 *
 * The builder locks funds at a script address under Data.toDatumHash, then
 * builds the spend. The builder does not yet put datum hash datums in the
 * witness set (txBuilder.ts, "datum resolution not yet implemented"), so the
 * test adds the datum to the built transaction, recomputes the script data
 * hash with Redeemers.toScriptDataHash, encodes with Transaction.toCBORHex,
 * signs with Transaction.addVKeyWitnessesBytes, and submits. Each case uses
 * one set of options for the script data hash and the encoding, and their
 * plutusData options for the datum hash: no options, CBOR.CML_DEFAULT_OPTIONS,
 * CBOR.TX_CANONICAL_OPTIONS, or plutusData set to PLUTUS_DATA_OPTIONS. The
 * node accepts the spend only when the written datum hashes to the locked
 * datum hash and the script data hash covers the datum and redeemer as
 * written.
 *
 * A last spend goes through the builder alone, with an inline datum: the
 * builder writes its redeemer data in the data default and the node accepts it.
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
import * as DatumHash from "@evolution-sdk/evolution/DatumHash"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as Redeemers from "@evolution-sdk/evolution/Redeemers"
import * as ScriptDataHash from "@evolution-sdk/evolution/ScriptDataHash"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"
import * as TxOut from "@evolution-sdk/evolution/TxOut"

import plutusJson from "../../evolution/test/spec/plutus.json"

const alwaysSucceed = plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")
if (!alwaysSucceed) throw new Error("always_succeed.always_succeed.spend not found in plutus.json")

describe("Witness datum layout (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const script = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(alwaysSucceed.compiledCode) })
  const scriptAddress = Address.Address.make({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) })

  // Constr 0 [{1: 2}, [3]]: the data default writes its map and lists
  // indefinite, PLUTUS_DATA_OPTIONS its map definite
  const mapAndList = Data.constr(0n, [Data.map([[Data.int(1n), Data.int(2n)]]), Data.list([Data.int(3n)])])

  // Each datum, the options it is written with, and the bytes they give for
  // the datum and for the spend redeemer, which is mapAndList. The datum
  // hashes differ, so each case spends its own output.
  const cases: ReadonlyArray<{
    name: string
    datum: Data.Data
    options: CBOR.TxCodecOptions | CBOR.CodecOptions | undefined
    datumHex: string
    redeemerHex: string
  }> = [
    {
      name: "Constr 0 [{1: 2}, [3]] with no options",
      datum: mapAndList,
      options: undefined,
      datumHex: "d8799fbf0102ff9f03ffff",
      redeemerHex: "d8799fbf0102ff9f03ffff"
    },
    {
      name: "Constr 0 [1] with CBOR.CML_DEFAULT_OPTIONS",
      datum: Data.constr(0n, [Data.int(1n)]),
      options: CBOR.CML_DEFAULT_OPTIONS,
      datumHex: "d8799f01ff",
      redeemerHex: "d8799fbf0102ff9f03ffff"
    },
    {
      name: "Constr 0 [{1: 2}, [3]] with CBOR.TX_CANONICAL_OPTIONS",
      datum: mapAndList,
      options: CBOR.TX_CANONICAL_OPTIONS,
      datumHex: "d87982a101028103",
      redeemerHex: "d87982a101028103"
    },
    {
      name: "Constr 0 [{1: 2}, [3]] with plutusData PLUTUS_DATA_OPTIONS",
      datum: mapAndList,
      options: { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.PLUTUS_DATA_OPTIONS },
      datumHex: "d8799fa101029f03ffff",
      redeemerHex: "d8799fa101029f03ffff"
    }
  ]

  // The options a case writes its Plutus data with
  const plutusDataOptions = (options: CBOR.TxCodecOptions | CBOR.CodecOptions | undefined) =>
    CBOR.toTxCodecOptions(options ?? CBOR.TX_DEFAULT_OPTIONS).plutusData

  // The output the builder-only spend takes
  const inlineDatum = new InlineDatum.InlineDatum({ data: Data.int(42n) })

  const ogmiosUrl = () => `http://localhost:${devnetCluster!.ports.ogmios}`

  const createTestClient = () => {
    if (!devnetCluster) throw new Error("Cluster not initialized")
    return Client.make(Cluster.getChain(devnetCluster))
      .withKupmios({ kupoUrl: `http://localhost:${devnetCluster.ports.kupo}`, ogmiosUrl: ogmiosUrl() })
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" })
  }

  const ogmios = async (method: string, params: unknown) => {
    const response = await fetch(ogmiosUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: null })
    })
    return (await response.json()) as { result?: any; error?: unknown }
  }

  beforeAll(async () => {
    expect(ScriptHash.toHex(ScriptHash.fromScript(script))).toBe(alwaysSucceed.hash)

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
      clusterName: "witness-datum-layout-test",
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

  it("locks one output under each datum hash, and one with an inline datum", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    let builder = client.newTx().payToAddress({
      address: scriptAddress,
      assets: Cardano.Assets.fromLovelace(10_000_000n),
      datum: inlineDatum
    })
    for (const { datum, datumHex, options } of cases) {
      expect(Data.toCBORHex(datum, plutusDataOptions(options))).toBe(datumHex)
      builder = builder.payToAddress({
        address: scriptAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n),
        datum: Data.toDatumHash(datum, plutusDataOptions(options))
      })
    }
    const lockSignBuilder = await builder.build({ availableUtxos: [...genesisUtxos] })
    const lockTxHash = await (await lockSignBuilder.sign()).submit()
    expect(await client.awaitTx(lockTxHash, 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(await client.getUtxos(scriptAddress)).toHaveLength(cases.length + 1)
  })

  for (const { datum, datumHex, name, options, redeemerHex } of cases) {
    it(`spends a datum hash output with ${name} in the witness set`, { timeout: 120_000 }, async () => {
      const client = createTestClient()
      const walletAddress = await client.address()
      const datumHash = Data.toDatumHash(datum, plutusDataOptions(options))

      const scriptUtxo = (await client.getUtxos(scriptAddress)).find(
        (utxo) =>
          utxo.datumOption?._tag === "DatumHash" &&
          DatumHash.toHex(utxo.datumOption as DatumHash.DatumHash) === DatumHash.toHex(datumHash)
      )
      expect(scriptUtxo).toBeDefined()

      // Build the spend; the builder leaves the witness datum out
      const spendSignBuilder = await client
        .newTx()
        .collectFrom({ inputs: [scriptUtxo!], redeemer: mapAndList })
        .attachScript({ script })
        .payToAddress({ address: walletAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })
        .build()
      const built = await spendSignBuilder.toTransaction()
      expect(built.witnessSet.plutusData ?? []).toHaveLength(0)
      const redeemers = built.witnessSet.redeemers!
      expect(redeemers.size).toBe(1)

      // The builder hashed the PlutusV3 language view only
      const params = await client.getProtocolParameters()
      const costModels = new CostModel.CostModels({
        PlutusV1: new CostModel.CostModel({ costs: [] }),
        PlutusV2: new CostModel.CostModel({ costs: [] }),
        PlutusV3: new CostModel.CostModel({ costs: Object.values(params.costModels.PlutusV3).map((v) => BigInt(v)) })
      })
      expect(ScriptDataHash.toHex(Redeemers.toScriptDataHash(redeemers, costModels))).toBe(
        ScriptDataHash.toHex(built.body.scriptDataHash!)
      )

      // Add the datum and its hash; pay the few extra bytes from the change output
      const feeBump = 10_000n
      const changeIndex = built.body.outputs.reduce(
        (best, output, i) =>
          Cardano.Assets.lovelaceOf(output.assets) > Cardano.Assets.lovelaceOf(built.body.outputs[best]!.assets)
            ? i
            : best,
        0
      )
      const outputs = built.body.outputs.map((output, i) =>
        i === changeIndex
          ? new TxOut.TransactionOutput({
              ...output,
              assets: Cardano.Assets.subtractLovelace(output.assets, feeBump)
            })
          : output
      )
      const tx = new Transaction.Transaction({
        body: new TransactionBody.TransactionBody({
          ...built.body,
          outputs,
          fee: built.body.fee + feeBump,
          scriptDataHash: Redeemers.toScriptDataHash(redeemers, costModels, [datum], options)
        }),
        witnessSet: new TransactionWitnessSet.TransactionWitnessSet({ ...built.witnessSet, plutusData: [datum] }),
        isValid: built.isValid,
        auxiliaryData: built.auxiliaryData
      })

      const txHex = Transaction.toCBORHex(tx, options)
      const txBytes = Bytes.fromHex(txHex)
      const walletUtxos = await client.getUtxos(walletAddress)
      const walletWitnessSet = await client.signTx(txHex, { utxos: [...walletUtxos, scriptUtxo!] })
      const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, TransactionWitnessSet.toCBORBytes(walletWitnessSet))
      const expectedTxId = TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(txBytes)))

      const submitted = await ogmios("submitTransaction", { transaction: { cbor: Bytes.toHex(signedBytes) } })
      expect(submitted.error).toBeUndefined()
      expect(submitted.result.transaction.id).toBe(expectedTxId)
      expect(await client.awaitTx(TransactionHash.fromHex(expectedTxId), 1000)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 2_000))

      // The witness set wrote the datum and redeemer data in the layout the hashes covered
      expect(Data.toCBORHex(mapAndList, plutusDataOptions(options))).toBe(redeemerHex)
      for (const hex of [txHex, Bytes.toHex(signedBytes)]) {
        expect(hex).toContain(`d9010281${datumHex}`)
        expect(hex).toContain(`05a182000082${redeemerHex}`)
      }
    })
  }

  it("spends with the builder alone, which writes the redeemer data in the data default", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const walletAddress = await client.address()
    const scriptUtxo = (await client.getUtxos(scriptAddress)).find((utxo) => utxo.datumOption?._tag === "InlineDatum")
    expect(scriptUtxo).toBeDefined()

    const signBuilder = await client
      .newTx()
      .collectFrom({ inputs: [scriptUtxo!], redeemer: mapAndList })
      .attachScript({ script })
      .payToAddress({ address: walletAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })
      .build()
    const builtHex = Transaction.toCBORHex(await signBuilder.toTransaction())
    expect(builtHex).toContain(`05a182000082${Data.toCBORHex(mapAndList)}`)
    expect(Data.toCBORHex(mapAndList)).toBe("d8799fbf0102ff9f03ffff")

    const txHash = await (await signBuilder.sign()).submit()
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
  })
})
