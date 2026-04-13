/**
 * Devnet test: spend from a UTxO whose script lives on its own scriptRef,
 * using only collectFrom() — no attachScript() or readFrom().
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import * as CoreAddress from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Data from "@evolution-sdk/evolution/Data"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import { inject } from "vitest"

import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

const CoreAssets = Cardano.Assets

describe("TxBuilder Spend ScriptRef (Devnet Submit)", () => {
  let shared: SharedClusterResult

  const ALWAYS_SUCCEED_COMPILED_CODE =
    "587e01010029800aba2aba1aab9eaab9dab9cab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c020dd500144c8cc892898058009805980600098049baa0028a50401830070013004375400f149a2a660049211856616c696461746f722072657475726e65642066616c7365001365640041"

  const ALWAYS_SUCCEED_HASH = "c5a309b71891d69bf076062a68fe46f9c54470128bb9fa0f2ac957d5"

  const alwaysSucceedScript = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(ALWAYS_SUCCEED_COMPILED_CODE) })
  const alwaysSucceedScriptHash = ScriptHash.fromScript(alwaysSucceedScript)

  const makeScriptAddress = (): CoreAddress.Address =>
    CoreAddress.Address.make({ networkId: 0, paymentCredential: alwaysSucceedScriptHash })

  beforeAll(async () => {
    expect(ScriptHash.toHex(alwaysSucceedScriptHash)).toBe(ALWAYS_SUCCEED_HASH)

    shared = await useSharedCluster(inject("sharedCluster" as any), [16])
  }, 180_000)

  it(
    "should submit a tx spending from a script UTxO with inline scriptRef",
    { timeout: 120_000 },
    async () => {
      const client = shared.makeClient(16)
      const walletAddress = await client.address()
      const scriptAddress = makeScriptAddress()

      const genesisUtxo = shared.getGenesisUtxo(16)

      // Phase 1: Deploy — pay to script address with inline datum + scriptRef
      const deploySignBuilder = await client
        .newTx()
        .payToAddress({
          address: scriptAddress,
          assets: CoreAssets.fromLovelace(10_000_000n),
          datum: new InlineDatum.InlineDatum({ data: Data.int(42n) }),
          script: alwaysSucceedScript
        })
        .build({ availableUtxos: [genesisUtxo] })

      const deployTxHash = await (await deploySignBuilder.sign()).submit()
      const deployConfirmed = await client.awaitTx(deployTxHash, 1000)
      expect(deployConfirmed).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 2_000))

      // Phase 2: Spend — collectFrom only, no attachScript / readFrom
      const scriptUtxos = await client.getUtxos(scriptAddress)
      expect(scriptUtxos.length).toBeGreaterThan(0)

      // Filter by deploy tx hash to isolate our UTxO from other test runs
      const deployTxHashHex = TransactionHash.toHex(deployTxHash)
      const scriptUtxo = scriptUtxos.find(
        (u) => TransactionHash.toHex(u.transactionId) === deployTxHashHex
      )
      if (!scriptUtxo) throw new Error("Script UTxO from deploy tx not found")
      expect(scriptUtxo.scriptRef?._tag).toBe("PlutusV3")

      const spendSignBuilder = await client
        .newTx()
        .collectFrom({ inputs: [scriptUtxo], redeemer: Data.int(42n) })
        .payToAddress({ address: walletAddress, assets: CoreAssets.fromLovelace(5_000_000n) })
        .build()

      const spendTx = await spendSignBuilder.toTransaction()
      expect(spendTx.body.scriptDataHash).toBeDefined()
      expect(spendTx.witnessSet.redeemers?.size).toBe(1)

      const spendTxHash = await (await spendSignBuilder.sign()).submit()

      const spendConfirmed = await client.awaitTx(spendTxHash, 1000)
      expect(spendConfirmed).toBe(true)
    }
  )
})
