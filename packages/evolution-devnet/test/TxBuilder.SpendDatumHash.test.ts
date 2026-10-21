/**
 * Devnet test: the builder spends datum hash outputs, and the node accepts
 * them. Each datum is in a layout the build's plutusData default does not
 * write, so it must keep the bytes it was fetched with.
 *
 * The lock transaction locks two outputs under each datum hash and publishes
 * the datums in its witness set, which the ledger allows for an output's datum
 * hash, so Kupo can serve them. The SDK cannot publish a datum, so the test
 * adds them by hand. One output more is locked under a datum that is never
 * published.
 *
 * For each datum, one output is spent with the datum fetched by client.getDatum
 * and given to collectFrom, and the other with build({ onMissingDatum:
 * "provider" }) under the canonical options. Before submitting, the aiken and
 * scalus evaluators each evaluate the spend.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import { createAikenEvaluator } from "@evolution-sdk/aiken-uplc"
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
import * as OriginalBytes from "@evolution-sdk/evolution/OriginalBytes"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as Redeemers from "@evolution-sdk/evolution/Redeemers"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"
import * as TxOut from "@evolution-sdk/evolution/TxOut"
import { createScalusEvaluator } from "@evolution-sdk/scalus-uplc"
import { blake2b } from "@noble/hashes/blake2.js"

import plutusJson from "../../evolution/test/spec/plutus.json"

const alwaysSucceed = plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")
if (!alwaysSucceed) throw new Error("always_succeed.always_succeed.spend not found in plutus.json")

// The datums, as other tools write them. The build default writes Constr 0
// [{1: 2}, [3]] as d8799fa101029f03ffff
const cases: ReadonlyArray<{ readonly name: string; readonly datumHex: string }> = [
  { name: "definite", datumHex: "d87982a101028103" },
  { name: "indefinite map", datumHex: "d8799fbf0102ff9f03ffff" },
  { name: "non-minimal lengths", datumHex: "d87998011801" },
  { name: "bare indefinite map", datumHex: "bf0102ff" },
  { name: "bytes chunked 1 then 64", datumHex: `5f41225840${"11".repeat(64)}ff` }
]

// A datum no transaction publishes
const UNPUBLISHED_HEX = "d87a80"

const hashOf = (datumHex: string) => Bytes.toHex(blake2b(Bytes.fromHex(datumHex), { dkLen: 32 }))

const withBytes = (datumHex: string): Data.Data => {
  const bytes = Bytes.fromHex(datumHex)
  const data = Data.fromCBORBytes(bytes)
  return typeof data === "bigint" ? data : OriginalBytes.record(data, bytes)
}

describe("Spend datum hash outputs (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const script = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(alwaysSucceed.compiledCode) })
  const scriptAddress = Address.Address.make({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) })
  const redeemer = Data.constr(0n, [])

  const ogmiosUrl = () => `http://localhost:${devnetCluster!.ports.ogmios}`
  const createTestClient = () =>
    Client.make(Cluster.getChain(devnetCluster!))
      .withKupmios({ kupoUrl: `http://localhost:${devnetCluster!.ports.kupo}`, ogmiosUrl: ogmiosUrl() })
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" })

  const ogmios = async (method: string, params: unknown) => {
    const response = await fetch(ogmiosUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: null })
    })
    return (await response.json()) as { result?: any; error?: unknown }
  }

  // The script outputs locked under a datum hash, in output order
  const lockedUnder = async (datumHex: string) => {
    const utxos = (await createTestClient().getUtxos(scriptAddress)).filter(
      (utxo) => utxo.datumOption?._tag === "DatumHash" && DatumHash.toHex(utxo.datumOption) === hashOf(datumHex)
    )
    return [...utxos].sort((a, b) => Number(a.index - b.index))
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
      clusterName: "spend-datum-hash-test",
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

  it("locks two outputs under each datum hash and publishes the datums", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    let builder = client.newTx()
    for (const datumHex of [...cases.flatMap(({ datumHex }) => [datumHex, datumHex]), UNPUBLISHED_HEX]) {
      builder = builder.payToAddress({
        address: scriptAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n),
        datum: DatumHash.fromHex(hashOf(datumHex))
      })
    }
    const built = await (await builder.build({ availableUtxos: [...genesisUtxos] })).toTransaction()

    // Publish the datums as supplemental datums; pay their bytes from the change
    const datums = cases.map(({ datumHex }) => withBytes(datumHex))
    const feeBump = 20_000n
    const changeIndex = built.body.outputs.length - 1
    const tx = new Transaction.Transaction({
      body: new TransactionBody.TransactionBody({
        ...built.body,
        outputs: built.body.outputs.map((output, i) =>
          i === changeIndex
            ? new TxOut.TransactionOutput({ ...output, assets: Cardano.Assets.subtractLovelace(output.assets, feeBump) })
            : output
        ),
        fee: built.body.fee + feeBump,
        scriptDataHash: Redeemers.toScriptDataHash(
          new Redeemers.RedeemerArray({ value: [] }),
          new CostModel.CostModels({
            PlutusV1: new CostModel.CostModel({ costs: [] }),
            PlutusV2: new CostModel.CostModel({ costs: [] }),
            PlutusV3: new CostModel.CostModel({ costs: [] })
          }),
          datums
        )
      }),
      witnessSet: new TransactionWitnessSet.TransactionWitnessSet({ ...built.witnessSet, plutusData: datums }),
      isValid: true,
      auxiliaryData: built.auxiliaryData
    })
    // Sign the object, not decoded bytes, so each datum keeps its bytes
    const walletWitnessSet = await client.signTx(Transaction.toCBORHex(tx), { utxos: [...genesisUtxos] })
    const signedHex = Transaction.toCBORHex(Transaction.addVKeyWitnesses(tx, walletWitnessSet.vkeyWitnesses ?? []))
    for (const { datumHex } of cases) expect(signedHex).toContain(datumHex)

    const submitted = await ogmios("submitTransaction", { transaction: { cbor: signedHex } })
    expect(submitted.error).toBeUndefined()
    expect(await client.awaitTx(TransactionHash.fromHex(submitted.result.transaction.id), 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    for (const { datumHex } of cases) expect(await lockedUnder(datumHex)).toHaveLength(2)
  })

  for (const { datumHex, name } of cases) {
    it(`spends the ${name} datum output with the datum given to collectFrom`, { timeout: 120_000 }, async () => {
      const client = createTestClient()
      const walletAddress = await client.address()
      const [utxo] = await lockedUnder(datumHex)
      if (utxo?.datumOption?._tag !== "DatumHash") throw new Error("expected a datum hash output")

      const spend = (datums?: ReadonlyArray<Data.Data>) =>
        client
          .newTx()
          .collectFrom({ inputs: [utxo], redeemer, datums })
          .attachScript({ script })
          .payToAddress({ address: walletAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })

      // No datum: the build fails before any evaluation and names both ways to give it
      await expect(spend().build()).rejects.toThrow('onMissingDatum: "provider"')

      const datum = await client.getDatum(utxo.datumOption)
      for (const evaluator of [createAikenEvaluator, createScalusEvaluator]) {
        const evaluated = await (await spend([datum]).build({ evaluator })).toTransaction()
        expect(Transaction.toCBORHex(evaluated)).toContain(`d9010281${datumHex}`)
      }

      const signBuilder = await spend([datum]).build()
      expect(Transaction.toCBORHex(await signBuilder.toTransaction())).toContain(`d9010281${datumHex}`)
      const txHash = await (await signBuilder.sign()).submit()
      expect(await client.awaitTx(txHash, 1000)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    })

    it(`spends the ${name} datum output with onMissingDatum: "provider" under canonical options`, { timeout: 120_000 }, async () => {
      const client = createTestClient()
      const walletAddress = await client.address()
      const [utxo] = await lockedUnder(datumHex)
      expect(utxo).toBeDefined()

      const spend = () =>
        client
          .newTx()
          .collectFrom({ inputs: [utxo!], redeemer })
          .attachScript({ script })
          .payToAddress({ address: walletAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })
      const options = { onMissingDatum: "provider", codecOptions: CBOR.TX_CANONICAL_OPTIONS } as const

      for (const evaluator of [createAikenEvaluator, createScalusEvaluator]) {
        const evaluated = await (await spend().build({ ...options, evaluator })).toTransaction()
        expect(Transaction.toCBORHex(evaluated)).toContain(`d9010281${datumHex}`)
      }

      const signBuilder = await spend().build(options)
      expect(Transaction.toCBORHex(await signBuilder.toTransaction())).toContain(`d9010281${datumHex}`)
      const txHash = await (await signBuilder.sign()).submit()
      expect(await client.awaitTx(txHash, 1000)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(await lockedUnder(datumHex)).toHaveLength(0)
    })
  }

  it("fails to fetch a datum no transaction published", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const [utxo] = await lockedUnder(UNPUBLISHED_HEX)
    expect(utxo).toBeDefined()
    await expect(
      client
        .newTx()
        .collectFrom({ inputs: [utxo!], redeemer })
        .attachScript({ script })
        .build({ onMissingDatum: "provider" })
    ).rejects.toThrow("provider.getDatum failed for datum hash")
  })
})
