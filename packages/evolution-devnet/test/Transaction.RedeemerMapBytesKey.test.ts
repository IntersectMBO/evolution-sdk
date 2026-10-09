/**
 * Devnet test: decoding a transaction and adding a witness keeps the original
 * bytes of a redeemer that holds a Plutus data map with a byte-string key.
 *
 * The node hashes the redeemer bytes as written into the script data hash. A
 * script spend whose redeemer is {h'01': [1, 2]} with an indefinite list is
 * signed over its raw body, merged with Transaction.addVKeyWitnessesBytes and
 * submitted as raw bytes. If the merge rewrites the list as definite, the node
 * rejects the transaction with a script data hash mismatch.
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
import * as PlutusData from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"
import { blake2b } from "@noble/hashes/blake2.js"

describe("Redeemer map with byte-string key (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  // always_succeed.always_succeed.spend from packages/evolution/test/spec
  const ALWAYS_SUCCEED_COMPILED_CODE =
    "587e01010029800aba2aba1aab9eaab9dab9cab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c020dd500144c8cc892898058009805980600098049baa0028a50401830070013004375400f149a2a660049211856616c696461746f722072657475726e65642066616c7365001365640041"

  const alwaysSucceedScript = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(ALWAYS_SUCCEED_COMPILED_CODE) })
  const scriptAddress = Address.Address.make({
    networkId: 0,
    paymentCredential: ScriptHash.fromScript(alwaysSucceedScript)
  })

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

  // Raw bytes of the witness set redeemers (key 5), as the node hashes them
  const redeemersBytes = (txBytes: Uint8Array): Uint8Array => {
    const witnessSetStart = CBOR.decodeItemWithOffset(txBytes, 1).newOffset
    // The witness set is a definite map with fewer than 24 entries
    const entryCount = txBytes[witnessSetStart] - 0xa0
    let offset = witnessSetStart + 1
    for (let i = 0; i < entryCount; i++) {
      const key = CBOR.decodeItemWithOffset(txBytes, offset)
      const value = CBOR.decodeItemWithOffset(txBytes, key.newOffset)
      if (key.item === 5n) return txBytes.slice(key.newOffset, value.newOffset)
      offset = value.newOffset
    }
    throw new Error("No redeemers in witness set")
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
      clusterName: "redeemer-map-bytes-key-test",
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

  it("keeps an indefinite list under a byte key through addVKeyWitnessesBytes", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const myAddress = await client.address()

    const deployBuilder = await client
      .newTx()
      .payToAddress({
        address: scriptAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n),
        datum: new InlineDatum.InlineDatum({ data: PlutusData.int(42n) })
      })
      .build({ availableUtxos: [...genesisUtxos] })
    const deployTxHash = await (await deployBuilder.sign()).submit()
    expect(await client.awaitTx(deployTxHash, 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    const scriptUtxos = await client.getUtxos(scriptAddress)
    expect(scriptUtxos.length).toBe(1)

    // The builder writes {h'01': [100, 2]} in the data default, a definite map and
    // an indefinite list (a1 41 01 9f 1864 02 ff). It is rewritten as {h'01': [1, 2]}
    // in the same layout (a1 41 01 9f 01 02 ff), which is shorter, so the fee still
    // covers it. The script ignores the redeemer.
    const builtRedeemerData = "a141019f186402ff"
    const redeemerData = "a141019f0102ff"
    const signBuilder = await client
      .newTx()
      .collectFrom({
        inputs: [...scriptUtxos],
        redeemer: PlutusData.map([
          [PlutusData.bytearray("01"), PlutusData.list([PlutusData.int(100n), PlutusData.int(2n)])]
        ])
      })
      .attachScript({ script: alwaysSucceedScript })
      .payToAddress({ address: myAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })
      .build()

    const builtTx = await signBuilder.toTransaction()
    const builtHex = Transaction.toCBORHex(builtTx)
    const builtScriptDataHash = Bytes.toHex(builtTx.body.scriptDataHash!.hash)

    // Language views for the one PlutusV3 script, checked against the builder's own hash
    const params = await client.getProtocolParameters()
    const languageViews = CostModel.languageViewsEncoding(
      new CostModel.CostModels({
        PlutusV1: new CostModel.CostModel({ costs: [] }),
        PlutusV2: new CostModel.CostModel({ costs: [] }),
        PlutusV3: new CostModel.CostModel({ costs: Object.values(params.costModels.PlutusV3).map((v) => BigInt(v)) })
      })
    )
    const scriptDataHash = (txBytes: Uint8Array) =>
      Bytes.toHex(blake2b(new Uint8Array([...redeemersBytes(txBytes), ...languageViews]), { dkLen: 32 }))
    expect(scriptDataHash(Bytes.fromHex(builtHex))).toBe(builtScriptDataHash)

    expect(builtHex.split(builtRedeemerData).length).toBe(2)
    expect(builtHex.split("0b5820" + builtScriptDataHash).length).toBe(2)
    const rewrittenHex = builtHex.replace(builtRedeemerData, redeemerData)
    const txHex = rewrittenHex.replace(
      "0b5820" + builtScriptDataHash,
      "0b5820" + scriptDataHash(Bytes.fromHex(rewrittenHex))
    )
    const txBytes = Bytes.fromHex(txHex)
    const bodyBytes = Transaction.extractBodyBytes(txBytes)
    const expectedTxId = TransactionHash.toHex(TransactionBody.toHashFromBytes(bodyBytes))

    // Sign over the raw body, then merge the witness into the decoded transaction
    const walletWitnessSet = await client.signTx(txHex, { utxos: [...genesisUtxos, ...scriptUtxos] })
    expect(walletWitnessSet.vkeyWitnesses?.length).toBe(1)
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, TransactionWitnessSet.toCBORBytes(walletWitnessSet))

    const submitted = await ogmios("submitTransaction", { transaction: { cbor: Bytes.toHex(signedBytes) } })
    expect(submitted.error).toBeUndefined()
    expect(submitted.result.transaction.id).toBe(expectedTxId)
    expect(Bytes.toHex(Transaction.extractBodyBytes(signedBytes))).toBe(Bytes.toHex(bodyBytes))
    expect(Bytes.toHex(redeemersBytes(signedBytes))).toBe(Bytes.toHex(redeemersBytes(txBytes)))
    expect(Bytes.toHex(redeemersBytes(signedBytes))).toContain(redeemerData)

    expect(await client.awaitTx(TransactionHash.fromHex(expectedTxId), 1000)).toBe(true)
  })
})
