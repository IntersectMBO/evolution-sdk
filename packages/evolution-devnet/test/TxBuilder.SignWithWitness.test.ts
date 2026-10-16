/**
 * Devnet test: a Plutus spend signed with SignBuilder.signWithWitness, given
 * only the wallet's vkey witnesses, as a hardware wallet returns them, keeps
 * the transaction's script and redeemer and is accepted.
 *
 * The builder locks funds at the always_succeed script address under an
 * inline datum, then builds the spend normally. The wallet's signTx gives the
 * witness set; only its vkey witnesses go to signWithWitness, and the result
 * is submitted.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Data from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"

import plutusJson from "../../evolution/test/spec/plutus.json"

const alwaysSucceed = plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")
if (!alwaysSucceed) throw new Error("always_succeed.always_succeed.spend not found in plutus.json")

describe("SignBuilder.signWithWitness (Devnet Submit)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxos: ReadonlyArray<Cardano.UTxO.UTxO> = []

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const script = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(alwaysSucceed.compiledCode) })
  const scriptAddress = Address.Address.make({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) })
  const inlineDatum = new InlineDatum.InlineDatum({ data: Data.int(42n) })
  const redeemer = Data.constr(0n, [Data.map([[Data.int(1n), Data.int(2n)]]), Data.list([Data.int(3n)])])

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
      clusterName: "sign-with-witness-test",
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

  it("locks an output at the script address", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const signBuilder = await client
      .newTx()
      .payToAddress({ address: scriptAddress, assets: Cardano.Assets.fromLovelace(10_000_000n), datum: inlineDatum })
      .build({ availableUtxos: [...genesisUtxos] })
    const txHash = await (await signBuilder.sign()).submit()
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(await client.getUtxos(scriptAddress)).toHaveLength(1)
  })

  it("spends it with signWithWitness given only the wallet's vkey witnesses", { timeout: 120_000 }, async () => {
    const client = createTestClient()
    const walletAddress = await client.address()
    const [scriptUtxo] = await client.getUtxos(scriptAddress)
    expect(scriptUtxo).toBeDefined()

    const signBuilder = await client
      .newTx()
      .collectFrom({ inputs: [scriptUtxo], redeemer })
      .attachScript({ script })
      .payToAddress({ address: walletAddress, assets: Cardano.Assets.fromLovelace(5_000_000n) })
      .build()
    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.plutusV3Scripts).toHaveLength(1)
    expect(tx.witnessSet.redeemers?.size).toBe(1)

    // The vkey witnesses alone, as a hardware wallet returns them
    const walletUtxos = await client.getUtxos(walletAddress)
    const walletWitnessSet = await client.signTx(tx, { utxos: [...walletUtxos, scriptUtxo] })
    const vkeyWitnesses = walletWitnessSet.vkeyWitnesses ?? []
    expect(vkeyWitnesses.length).toBeGreaterThan(0)

    const submitBuilder = await signBuilder.signWithWitness(TransactionWitnessSet.fromVKeyWitnesses([...vkeyWitnesses]))
    expect(submitBuilder.witnessSet.plutusV3Scripts).toHaveLength(1)
    expect(submitBuilder.witnessSet.redeemers?.size).toBe(1)
    expect(submitBuilder.witnessSet.vkeyWitnesses).toHaveLength(vkeyWitnesses.length)

    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash)).toBe(TransactionHash.toHex(TransactionBody.toHash(tx.body)))
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(await client.getUtxos(scriptAddress)).toHaveLength(0)
  })
})
