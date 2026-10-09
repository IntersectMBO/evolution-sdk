/**
 * Devnet test: a new inline datum is written with the plutusData transaction
 * options, and the node keeps it as written.
 *
 * The builder writes a transaction with an inline map datum. Each case
 * rebuilds that transaction with a new InlineDatum, encodes it with
 * Transaction.toCBORHex under one option set, signs it over the raw body with
 * Transaction.addVKeyWitnessesBytes, and submits the bytes. The ledger returns
 * the datum, which must be the bytes Data.toCBORHex writes under the case's
 * plutusData options.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import * as Data from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"
import * as TxOut from "@evolution-sdk/evolution/TxOut"

describe("Inline datum options (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  // {1: [2]}: each option set below writes it differently, or with a
  // different ledger layout around it
  const datum = Data.map([[Data.int(1n), Data.list([Data.int(2n)])]])

  const cases: ReadonlyArray<{ name: string; options: CBOR.TxCodecOptions; datumHex: string }> = [
    { name: "CBOR.TX_DEFAULT_OPTIONS", options: CBOR.TX_DEFAULT_OPTIONS, datumHex: "a1019f02ff" },
    { name: "CBOR.TX_CANONICAL_OPTIONS", options: CBOR.TX_CANONICAL_OPTIONS, datumHex: "a1018102" },
    {
      name: "plutusData CML_DATA_DEFAULT_OPTIONS",
      options: { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFAULT_OPTIONS },
      datumHex: "bf019f02ffff"
    },
    {
      name: "plutusData CML_DATA_DEFINITE_OPTIONS",
      options: { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFINITE_OPTIONS },
      datumHex: "a1018102"
    }
  ]

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
      clusterName: "inline-datum-options-test",
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

  cases.forEach(({ datumHex, name, options }, caseIndex) => {
    it(`writes and keeps an inline map datum under ${name}`, { timeout: 120_000 }, async () => {
      const client = createTestClient()
      const myAddress = await client.address()
      expect(Data.toCBORHex(datum, options.plutusData)).toBe(datumHex)

      const signBuilder = await client
        .newTx()
        .payToAddress({
          address: myAddress,
          assets: Cardano.Assets.fromLovelace(5_000_000n),
          datum: new InlineDatum.InlineDatum({ data: datum })
        })
        .build(caseIndex === 0 ? { availableUtxos: [...genesisUtxos] } : undefined)
      const built = await signBuilder.toTransaction()

      // A new InlineDatum in each output that holds one, and a fee that
      // covers the few extra bytes, paid from the largest output
      const feeBump = 10_000n
      const changeIndex = built.body.outputs.reduce(
        (best, output, i) =>
          Cardano.Assets.lovelaceOf(output.assets) > Cardano.Assets.lovelaceOf(built.body.outputs[best]!.assets)
            ? i
            : best,
        0
      )
      const outputs = built.body.outputs.map(
        (output, i) =>
          new TxOut.TransactionOutput({
            ...output,
            assets:
              i === changeIndex ? Cardano.Assets.subtractLovelace(output.assets, feeBump) : output.assets,
            datumOption:
              output.datumOption?._tag === "InlineDatum"
                ? new InlineDatum.InlineDatum({ data: output.datumOption.data })
                : output.datumOption
          })
      )
      const datumIndex = outputs.findIndex((output) => output.datumOption?._tag === "InlineDatum")
      expect(datumIndex).toBeGreaterThanOrEqual(0)
      const tx = new Transaction.Transaction({
        ...built,
        body: new TransactionBody.TransactionBody({ ...built.body, outputs, fee: built.body.fee + feeBump })
      })

      const txHex = Transaction.toCBORHex(tx, options)
      expect(txHex).toContain(`d818${(0x40 + datumHex.length / 2).toString(16)}${datumHex}`)
      const txBytes = Bytes.fromHex(txHex)
      const bodyBytes = Transaction.extractBodyBytes(txBytes)
      const expectedTxId = TransactionHash.toHex(TransactionBody.toHashFromBytes(bodyBytes))

      const walletWitnessSet = await client.signTx(txHex, {
        utxos: caseIndex === 0 ? [...genesisUtxos] : await client.getUtxos(myAddress)
      })
      const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, TransactionWitnessSet.toCBORBytes(walletWitnessSet))
      expect(Bytes.toHex(Transaction.extractBodyBytes(signedBytes))).toBe(Bytes.toHex(bodyBytes))

      const submitted = await ogmios("submitTransaction", { transaction: { cbor: Bytes.toHex(signedBytes) } })
      expect(submitted.error).toBeUndefined()
      expect(submitted.result.transaction.id).toBe(expectedTxId)
      expect(await client.awaitTx(TransactionHash.fromHex(expectedTxId), 1000)).toBe(true)

      const utxos = await ogmios("queryLedgerState/utxo", {
        outputReferences: [{ transaction: { id: expectedTxId }, index: datumIndex }]
      })
      expect((utxos.result as Array<{ datum?: string }>).map((utxo) => utxo.datum)).toEqual([datumHex])
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    })
  })
})
