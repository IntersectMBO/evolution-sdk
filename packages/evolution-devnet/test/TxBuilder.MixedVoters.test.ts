/**
 * Devnet test for a single governance vote transaction carrying BOTH a Plutus-script
 * DRep voter and a native-script (multisig) DRep voter.
 *
 * This exercises the build-time native-vs-Plutus classification end-to-end:
 * - the Plutus voter keeps its redeemer,
 * - the native voter's redeemer is pruned (it is satisfied by vkey witnesses),
 * - and the ledger accepts the mixed transaction.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import type { Cardano } from "@evolution-sdk/evolution"
import { Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Data from "@evolution-sdk/evolution/Data"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as GovernanceAction from "@evolution-sdk/evolution/GovernanceAction"
import * as NativeScripts from "@evolution-sdk/evolution/NativeScripts"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Url from "@evolution-sdk/evolution/Url"
import * as VotingProcedures from "@evolution-sdk/evolution/VotingProcedures"

import plutusJson from "../../evolution/test/spec/plutus.json"

const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

const loadValidator = (title: string) => {
  const validator = plutusJson.validators.find((v: any) => v.title === title)
  if (!validator) throw new Error(`${title} validator not found`)
  return validator.compiledCode
}

const makeAnchor = (url: string) =>
  new Anchor.Anchor({
    anchorUrl: new Url.Url({ href: url }),
    anchorDataHash: Bytes32.fromHex("0".repeat(64))
  })

describe("TxBuilder Mixed Voters (Plutus + native DRep in one vote tx)", () => {
  let devnetCluster: Cluster.Cluster | undefined

  const createTestClient = (accountIndex: number = 0) => {
    if (!devnetCluster) throw new Error("Cluster not initialized")
    return Client.make(Cluster.getChain(devnetCluster))
      .withKupmios({
        kupoUrl: `http://localhost:${devnetCluster!.ports.kupo}`,
        ogmiosUrl: `http://localhost:${devnetCluster!.ports.ogmios}`
      })
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })
  }
  const genesisUtxosByAccount: Map<number, Cardano.UTxO.UTxO> = new Map()

  beforeAll(async () => {
    const accounts = [0, 1].map((accountIndex) =>
      Client.make(preprod).withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })
    )
    const addresses = await Promise.all(accounts.map((client) => client.address()))

    const genesisConfig: Config.ShelleyGenesis = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: Object.fromEntries(addresses.map((addr) => [Address.toHex(addr), 500_000_000_000]))
    }

    const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)
    addresses.forEach((addr, i) => {
      const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(addr))
      if (utxo) genesisUtxosByAccount.set(i, utxo)
    })

    devnetCluster = await Cluster.make({
      clusterName: "mixed-voters-test",
      shelleyGenesis: genesisConfig,
      conwayGenesis: { ...Config.DEFAULT_CONWAY_GENESIS, govActionLifetime: 30 },
      kupo: { enabled: true, logLevel: "Info" },
      ogmios: { enabled: true, logLevel: "info" }
    })

    await Cluster.start(devnetCluster)
    await new Promise((r) => setTimeout(r, 3_000))
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  it("casts a vote from a Plutus DRep and a native-script DRep in one transaction", { timeout: 180_000 }, async () => {
    const client0 = createTestClient(0)
    const client1 = createTestClient(1)
    const address0 = await client0.address()
    const address1 = await client1.address()
    if (!address0.stakingCredential) throw new Error("Need staking credential")

    const pkh0 = address0.paymentCredential
    const pkh1 = address1.paymentCredential
    if (pkh0._tag !== "KeyHash" || pkh1._tag !== "KeyHash") {
      throw new Error("Need key hash credentials")
    }

    // Plutus-script DRep (always_yes_drep: publish + vote always succeed)
    const plutusScript = new PlutusV3.PlutusV3({
      bytes: Bytes.fromHex(loadValidator("governance_voting.always_yes_drep.publish"))
    })
    const plutusScriptHash = ScriptHash.fromScript(plutusScript)
    const plutusDRepCredential = new ScriptHash.ScriptHash({ hash: plutusScriptHash.hash })
    const plutusRedeemer = Data.constr(0n, [Data.int(1n)])

    // Native-script DRep (2-of-2 multisig of pkh0 + pkh1)
    const nativeScript = NativeScripts.makeScriptNOfK(2n, [
      NativeScripts.makeScriptPubKey(pkh0.hash).script,
      NativeScripts.makeScriptPubKey(pkh1.hash).script
    ])
    const nativeScriptHash = ScriptHash.fromScript(nativeScript)
    const nativeDRepCredential = new ScriptHash.ScriptHash({ hash: nativeScriptHash.hash })

    // Register stake (required for proposal submission).
    const stakeRegTx = await client0
      .newTx()
      .registerStake({ stakeCredential: address0.stakingCredential })
      .build({ availableUtxos: [genesisUtxosByAccount.get(0)!] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client0.awaitTx(stakeRegTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Register the Plutus-script DRep (redeemer required).
    const plutusDRepRegTx = await client0
      .newTx()
      .registerDRep({
        drepCredential: plutusDRepCredential,
        anchor: makeAnchor("https://example.com/plutus-drep.json"),
        redeemer: plutusRedeemer
      })
      .attachScript({ script: plutusScript })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client0.awaitTx(plutusDRepRegTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Register the native-script DRep (no redeemer; authorized by the 2-of-2 signatures).
    const nativeRegSignBuilder = await client0
      .newTx()
      .registerDRep({
        drepCredential: nativeDRepCredential,
        anchor: makeAnchor("https://example.com/native-drep.json")
      })
      .attachScript({ script: nativeScript })
      .build()

    // The native registration tx must NOT carry redeemers or a script data hash.
    const nativeRegTx = await nativeRegSignBuilder.toTransaction()
    expect(nativeRegTx.witnessSet.redeemers).toBeUndefined()
    expect(nativeRegTx.body.scriptDataHash).toBeUndefined()
    expect(nativeRegTx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)

    const nativeRegWitness0 = await nativeRegSignBuilder.partialSign()
    const nativeRegWitness1 = await client1.signTx(nativeRegTx)
    const nativeRegTxHash = await nativeRegSignBuilder
      .assemble([nativeRegWitness0, nativeRegWitness1])
      .then((b) => b.submit())
    expect(await client0.awaitTx(nativeRegTxHash, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Create a proposal to vote on.
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address0.stakingCredential
    })
    const proposeTx = await client0
      .newTx()
      .propose({
        governanceAction: new GovernanceAction.InfoAction({}),
        rewardAccount,
        anchor: makeAnchor("https://example.com/proposal.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client0.awaitTx(proposeTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // --- The mixed vote: BOTH DReps vote yes on the same governance action ---
    const govActionId = new GovernanceAction.GovActionId({
      transactionId: proposeTx,
      govActionIndex: 0n
    })
    const yesProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })

    const votingProcedures = new VotingProcedures.VotingProcedures({
      procedures: new Map([
        [
          new VotingProcedures.DRepVoter({ drep: DRep.fromScriptHash(plutusScriptHash) }),
          new Map([[govActionId, yesProcedure]])
        ],
        [
          new VotingProcedures.DRepVoter({ drep: DRep.fromScriptHash(nativeScriptHash) }),
          new Map([[govActionId, yesProcedure]])
        ]
      ])
    })

    // The redeemer is applied to all script voters; the native voter's copy is pruned at
    // build time, leaving exactly one redeemer for the Plutus voter.
    const voteSignBuilder = await client0
      .newTx()
      .vote({ votingProcedures, redeemer: plutusRedeemer })
      .attachScript({ script: plutusScript })
      .attachScript({ script: nativeScript })
      .build()

    const voteTx = await voteSignBuilder.toTransaction()

    expect(voteTx.body.scriptDataHash).toBeDefined()
    expect(voteTx.witnessSet.plutusV3Scripts?.length ?? 0).toBeGreaterThan(0)
    expect(voteTx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)

    const voteWitness0 = await voteSignBuilder.partialSign()
    const voteWitness1 = await client1.signTx(voteTx)
    const submitBuilder = await voteSignBuilder.assemble([voteWitness0, voteWitness1])
    const voteTxHash = await submitBuilder.submit()

    expect(await client0.awaitTx(voteTxHash, 1000)).toBe(true)
  })
})
