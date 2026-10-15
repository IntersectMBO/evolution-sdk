/**
 * Devnet test: the seed wallet's signTx, given a Transaction decoded from
 * bytes the SDK encoder does not write, signs the body bytes it was decoded
 * from, and the node accepts the witness.
 *
 * The body has a required signer and its keys written in the order 2, 0, 1,
 * 14, which is valid but not the order the SDK writes. The test signs the
 * decoded Transaction, merges the witness into the hex with
 * Transaction.addVKeyWitnessesHex and submits that hex through Ogmios, so no
 * SDK encoder touches the body. A signature over a re-encoded body fails
 * with invalid signatures.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"

describe("signTx with a decoded Transaction (Devnet Submit)", () => {
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

  const concat = (...parts: ReadonlyArray<Uint8Array>) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.length
    }
    return out
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
      clusterName: "sign-tx-decoded-test",
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

  it("signs the body bytes of a body with keys in the order 2, 0, 1, 14", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const walletAddress = await client.address()
    const paymentCredential = walletAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") throw new Error("Expected KeyHash credential")

    const signBuilder = await client
      .newTx()
      .addSigner({ keyHash: paymentCredential })
      .payToAddress({ address: walletAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })
      .build({ availableUtxos: [...genesisUtxos] })
    const builtBytes = Transaction.toCBORBytes(await signBuilder.toTransaction())

    // The SDK writes the body as a map with keys 0, 1, 2 and 14 in that order
    const bodyBytes = Transaction.extractBodyBytes(builtBytes)
    expect(bodyBytes[0]).toBe(0xa4)
    const entries: Array<Uint8Array> = []
    let offset = 1
    while (offset < bodyBytes.length) {
      const { newOffset } = CBOR.decodeItemWithOffset(bodyBytes, offset)
      entries.push(bodyBytes.subarray(offset, newOffset))
      offset = newOffset
    }
    const keys = entries.filter((_, i) => i % 2 === 0).map((k) => Bytes.toHex(k))
    expect(keys).toEqual(["00", "01", "02", "0e"])
    const field = (key: number) => {
      const i = entries.findIndex((e, j) => j % 2 === 0 && e.length === 1 && e[0] === key)
      return concat(entries[i]!, entries[i + 1]!)
    }

    // The same body with its keys in the order 2, 0, 1, 14; the fee covers the same size
    const reordered = concat(Uint8Array.of(0xa4), field(2), field(0), field(1), field(14))
    const txHex = Bytes.toHex(concat(Uint8Array.of(0x84), reordered, builtBytes.subarray(1 + bodyBytes.length)))
    const expectedTxId = TransactionHash.toHex(TransactionBody.toHashFromBytes(reordered))

    // The decoded Transaction writes the original bytes back, while its body
    // alone re-encodes in the SDK order, under another id
    const tx = Transaction.fromCBORHex(txHex)
    expect(Transaction.toCBORHex(tx)).toBe(txHex)
    expect(TransactionHash.toHex(TransactionBody.toHash(tx.body))).not.toBe(expectedTxId)

    // The object path signs what the hex path signs
    const fromObject = await client.signTx(tx, { utxos: [...genesisUtxos] })
    const fromHex = await client.signTx(txHex, { utxos: [...genesisUtxos] })
    expect(fromObject.vkeyWitnesses).toHaveLength(1)
    expect(TransactionWitnessSet.toCBORHex(fromObject)).toBe(TransactionWitnessSet.toCBORHex(fromHex))

    const signedHex = Transaction.addVKeyWitnessesHex(txHex, TransactionWitnessSet.toCBORHex(fromObject))
    expect(Bytes.toHex(Transaction.extractBodyBytes(Bytes.fromHex(signedHex)))).toBe(Bytes.toHex(reordered))

    const submitted = await ogmios("submitTransaction", { transaction: { cbor: signedHex } })
    expect(submitted.error).toBeUndefined()
    expect(submitted.result.transaction.id).toBe(expectedTxId)
    expect(await client.awaitTx(TransactionHash.fromHex(expectedTxId), 1000)).toBe(true)
  })
})
