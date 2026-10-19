/**
 * Devnet test: an address holding a deeply nested inline datum still reads back.
 *
 * The ledger limits the size of each Plutus data leaf, not the depth, so a datum
 * can nest as deep as a transaction allows. Each case pays a datum nested about
 * 15,000 levels and a plain UTxO to a fresh address, submits the transaction as
 * raw bytes, and reads both UTxOs back through Kupmios.
 *
 * The SDK encoders still recurse, so the builder writes a flat list of the same
 * encoded length and the deep datum is spliced in over it. The body is signed by
 * hand, so no step before `getUtxos` decodes the deep datum.
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
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as PrivateKey from "@evolution-sdk/evolution/PrivateKey"
import * as Derivation from "@evolution-sdk/evolution/sdk/wallet/Derivation"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionInput from "@evolution-sdk/evolution/TransactionInput"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"

describe("Deeply nested inline datums (Devnet Submit)", () => {
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
      clusterName: "datum-depth-test",
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

  // A list of zeros whose encoding is exactly `length` bytes, as the builder writes it
  const flatListOfLength = (length: number): string => {
    const encode = (count: number) => PlutusData.toCBORHex(PlutusData.list(Array.from({ length: count }, () => 0n)))
    const first = encode(length)
    const hex = encode(2 * length - first.length / 2)
    expect(hex.length / 2).toBe(length)
    return hex
  }

  // Levels of `open` above the leaf 0
  const depthOf = (data: PlutusData.Data, isLevel: (data: PlutusData.Data) => PlutusData.Data | undefined): number => {
    let levels = 0
    let current: PlutusData.Data | undefined = data
    for (;;) {
      const inner: PlutusData.Data | undefined = isLevel(current)
      if (inner === undefined) return current === 0n ? levels : -1
      current = inner
      levels++
    }
  }

  const cases = [
    {
      name: "a list nested 15,000 levels",
      datum: "81".repeat(15_000) + "00",
      levels: 15_000,
      inner: (data: PlutusData.Data) => (Array.isArray(data) && data.length === 1 ? data[0] : undefined)
    },
    {
      name: "a constructor nested 5,000 levels",
      datum: "d87981".repeat(5_000) + "00",
      levels: 5_000,
      inner: (data: PlutusData.Data) =>
        data instanceof PlutusData.Constr && data.index === 0n && data.fields.length === 1 ? data.fields[0] : undefined
    }
  ]

  for (const [caseIndex, testCase] of cases.entries()) {
    it(`getUtxos returns every UTxO at an address holding ${testCase.name}`, { timeout: 120_000 }, async () => {
      const client = createTestClient()
      const myAddress = await client.address()
      const target = new Address.Address({
        networkId: 0,
        paymentCredential: KeyHash.fromPrivateKey(PrivateKey.fromBytes(PrivateKey.generate()))
      })

      const datumLength = testCase.datum.length / 2
      const placeholder = flatListOfLength(datumLength)
      const signBuilder = await client
        .newTx()
        .payToAddress({
          address: target,
          assets: Cardano.Assets.fromLovelace(70_000_000n),
          datum: new InlineDatum.InlineDatum({ data: PlutusData.fromCBORHex(placeholder) })
        })
        .payToAddress({
          address: target,
          assets: Cardano.Assets.fromLovelace(2_000_000n),
          datum: new InlineDatum.InlineDatum({ data: PlutusData.int(1n) })
        })
        .build(caseIndex === 0 ? { availableUtxos: [...genesisUtxos] } : {})

      // Swap the flat list for the deep datum of the same length, so the fee and the
      // minimum ADA the builder computed still hold
      const header = `d81859${datumLength.toString(16).padStart(4, "0")}`
      const builtHex = Transaction.toCBORHex(await signBuilder.toTransaction())
      expect(builtHex.split(header + placeholder).length).toBe(2)
      const unsignedHex = builtHex.replace(header + placeholder, header + testCase.datum)
      const bodyBytes = Transaction.extractBodyBytes(Bytes.fromHex(unsignedHex))
      expect(unsignedHex).toBe(`84${Bytes.toHex(bodyBytes)}a0f5f6`)

      // Sign the body hash with the wallet's payment key and write the witness set by hand
      const txId = TransactionBody.toHashFromBytes(bodyBytes)
      const paymentKey = PrivateKey.fromBech32(Derivation.keysFromSeed(TEST_MNEMONIC, { accountIndex: 0 }).paymentKey)
      const witnessSet = new TransactionWitnessSet.TransactionWitnessSet({
        vkeyWitnesses: [
          new TransactionWitnessSet.VKeyWitness({
            vkey: PrivateKey.toPublicKey(paymentKey),
            signature: PrivateKey.sign(paymentKey, txId.hash)
          })
        ]
      })
      const signedHex = `84${Bytes.toHex(bodyBytes)}${TransactionWitnessSet.toCBORHex(witnessSet)}f5f6`
      expect(signedHex.length / 2).toBeLessThanOrEqual(16_384)

      // The ledger accepting the transaction is the proof that such a datum is valid
      const submitted = await ogmios("submitTransaction", { transaction: { cbor: signedHex } })
      expect(submitted.error).toBeUndefined()
      expect(submitted.result.transaction.id).toBe(TransactionHash.toHex(txId))
      expect(await client.awaitTx(txId, 1000)).toBe(true)

      // The ledger keeps the datum exactly as written
      const ledger = await ogmios("queryLedgerState/utxo", {
        outputReferences: [{ transaction: { id: TransactionHash.toHex(txId) }, index: 0 }]
      })
      expect(ledger.result[0].datum).toBe(testCase.datum)

      // Both UTxOs at the address decode, the deep one included
      const utxos = await client.getUtxos(target)
      expect(utxos.map((utxo) => utxo.index).sort()).toEqual([0n, 1n])
      const deep = utxos.find((utxo) => utxo.index === 0n)?.datumOption
      expect(deep instanceof InlineDatum.InlineDatum ? depthOf(deep.data, testCase.inner) : -1).toBe(testCase.levels)

      const [byOutRef] = await client.getUtxosByOutRef([
        new TransactionInput.TransactionInput({ transactionId: txId, index: 0n })
      ])
      const byOutRefDatum = byOutRef?.datumOption
      expect(byOutRefDatum instanceof InlineDatum.InlineDatum ? depthOf(byOutRefDatum.data, testCase.inner) : -1).toBe(
        testCase.levels
      )

      // The wallet's own UTxOs, which the next case spends, are unaffected
      expect((await client.getUtxos(myAddress)).length).toBeGreaterThan(0)
    })
  }
})
