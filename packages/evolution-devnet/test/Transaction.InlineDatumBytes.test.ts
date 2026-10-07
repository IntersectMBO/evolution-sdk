/**
 * Devnet test: decoding a transaction and adding a witness keeps every inline
 * datum's original bytes.
 *
 * The node keeps each inline datum exactly as written and the transaction id is
 * the hash of the body bytes. A transaction carrying one inline datum as a
 * definite map (a1...) and one as an indefinite map (bf...) is signed over its
 * raw body, merged with Transaction.addVKeyWitnessesBytes, submitted as raw
 * bytes, and the datums are read back from the ledger.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as PlutusData from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"

describe("Inline datum bytes (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

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
      clusterName: "inline-datum-bytes-test",
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

  it("keeps definite and indefinite map datums through addVKeyWitnessesBytes", { timeout: 90_000 }, async () => {
    const client = createTestClient()
    const myAddress = await client.address()

    // The builder writes both maps indefinite (bf...ff). The second one is then
    // rewritten as a definite map (a1...), one byte shorter, so the fee still covers it.
    const indefiniteDatum = "bf0102ff"
    const definiteDatum = "a10304"
    const signBuilder = await client
      .newTx()
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n),
        datum: new InlineDatum.InlineDatum({ data: PlutusData.map([[PlutusData.int(1n), PlutusData.int(2n)]]) })
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(5_000_000n),
        datum: new InlineDatum.InlineDatum({ data: PlutusData.map([[PlutusData.int(3n), PlutusData.int(4n)]]) })
      })
      .build({ availableUtxos: [...genesisUtxos] })

    const builtHex = Transaction.toCBORHex(await signBuilder.toTransaction())
    expect(builtHex.split("d81844" + indefiniteDatum).length).toBe(2)
    expect(builtHex.split("d81844bf0304ff").length).toBe(2)
    const txHex = builtHex.replace("d81844bf0304ff", "d81843" + definiteDatum)
    const txBytes = Bytes.fromHex(txHex)
    const bodyBytes = Transaction.extractBodyBytes(txBytes)
    const expectedTxId = TransactionHash.toHex(TransactionBody.toHashFromBytes(bodyBytes))

    // Sign over the raw body, then merge the witness into the decoded transaction
    const walletWitnessSet = await client.signTx(txHex, { utxos: [...genesisUtxos] })
    expect(walletWitnessSet.vkeyWitnesses?.length).toBe(1)
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, TransactionWitnessSet.toCBORBytes(walletWitnessSet))

    const submitted = await ogmios("submitTransaction", { transaction: { cbor: Bytes.toHex(signedBytes) } })
    expect(submitted.error).toBeUndefined()
    expect(submitted.result.transaction.id).toBe(expectedTxId)
    expect(Bytes.toHex(Transaction.extractBodyBytes(signedBytes))).toBe(Bytes.toHex(bodyBytes))

    expect(await client.awaitTx(TransactionHash.fromHex(expectedTxId), 1000)).toBe(true)

    const utxos = await ogmios("queryLedgerState/utxo", {
      outputReferences: [
        { transaction: { id: expectedTxId }, index: 0 },
        { transaction: { id: expectedTxId }, index: 1 }
      ]
    })
    const datums = (utxos.result as Array<{ index: number; datum?: string }>)
      .sort((a, b) => a.index - b.index)
      .map((utxo) => utxo.datum)
    expect(datums).toEqual([indefiniteDatum, definiteDatum])
  })
})
