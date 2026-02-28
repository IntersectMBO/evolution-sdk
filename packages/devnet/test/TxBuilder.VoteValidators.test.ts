/**
 * Devnet tests for vote validators (script-controlled DRep).
 * Tests PlutusV3 vote validators for:
 * - Publishing purpose (DRep registration)
 * - Voting purpose (casting votes)
 * - Quorum-based voting with reference inputs
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Data from "@evolution-sdk/evolution/Data"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as GovernanceAction from "@evolution-sdk/evolution/GovernanceAction"
import * as InlineDatum from "@evolution-sdk/evolution/InlineDatum"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as Url from "@evolution-sdk/evolution/Url"
import * as VotingProcedures from "@evolution-sdk/evolution/VotingProcedures"

import plutusJson from "../../evolution/test/spec/plutus.json"

// Alias for readability
const Time = Cardano.Time

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

describe("TxBuilder Vote Validator (script DRep)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let slotConfig: Cluster.SlotConfig | undefined

  const createTestClient = (accountIndex: number = 0) => {
    if (!slotConfig) throw new Error("slotConfig not initialized")
    return createClient({
      network: 0,
      slotConfig,
      provider: {
        type: "kupmios",
        kupoUrl: "http://localhost:1453",
        ogmiosUrl: "http://localhost:1343"
      },
      wallet: {
        type: "seed",
        mnemonic: TEST_MNEMONIC,
        accountIndex,
        addressType: "Base"
      }
    })
  }
  const genesisUtxosByAccount: Map<number, Cardano.UTxO.UTxO> = new Map()

  beforeAll(async () => {
    const accounts = [0, 1].map((accountIndex) =>
      createClient({
        network: 0,
        wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" }
      })
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
      clusterName: "vote-validator-test",
      ports: { node: 6010, submit: 9010 },
      shelleyGenesis: genesisConfig,
      conwayGenesis: Config.DEFAULT_CONWAY_GENESIS,
      kupo: { enabled: true, port: 1453, logLevel: "Info" },
      ogmios: { enabled: true, port: 1343, logLevel: "info" }
    })

    slotConfig = Cluster.getSlotConfig(devnetCluster)

    await Cluster.start(devnetCluster)
    await new Promise((r) => setTimeout(r, 3_000))
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  it("validates always_yes_drep for Publishing and Voting", { timeout: 180_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()
    if (!address.stakingCredential) throw new Error("Need staking credential")

    // Register stake (required for proposal submission)
    const stakeRegTx = await client
      .newTx()
      .registerStake({ stakeCredential: address.stakingCredential })
      .build({ availableUtxos: [genesisUtxosByAccount.get(0)!] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(stakeRegTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Create vote validator
    const voteScript = new PlutusV3.PlutusV3({
      bytes: Bytes.fromHex(loadValidator("governance_voting.always_yes_drep.publish"))
    })
    const scriptHash = ScriptHash.fromScript(voteScript)
    const drepCredential = new ScriptHash.ScriptHash({ hash: scriptHash.hash })
    const redeemer = Data.constr(0n, [Data.int(1n)])

    // Test Publishing purpose - register script-controlled DRep
    const drepRegTx = await client
      .newTx()
      .registerDRep({ drepCredential, anchor: makeAnchor("https://example.com/drep.json"), redeemer })
      .attachScript({ script: voteScript })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(drepRegTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Create proposal to vote on
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })
    const proposeTx = await client
      .newTx()
      .propose({
        governanceAction: new GovernanceAction.InfoAction({}),
        rewardAccount,
        anchor: makeAnchor("https://example.com/proposal.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(proposeTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Test Voting purpose - vote using script-controlled DRep
    const govActionId = new GovernanceAction.GovActionId({
      transactionId: proposeTx,
      govActionIndex: 0n
    })
    const scriptDRep = DRep.fromScriptHash(scriptHash)
    const votingProcedures = VotingProcedures.singleVote(
      new VotingProcedures.DRepVoter({ drep: scriptDRep }),
      govActionId,
      new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    )

    const voteTx = await client
      .newTx()
      .vote({ votingProcedures, redeemer })
      .attachScript({ script: voteScript })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(voteTx, 1000)).toBe(true)
  })

  it("validates quorum-based voting with reference input", { timeout: 180_000 }, async () => {
    // Uses governance_voting validator requiring:
    // - Reference input with GovernanceConfig datum
    // - VoteRedeemer with participating_signers
    // - Extra signatories matching quorum threshold

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

    // Register stake (may already exist from test 1)
    try {
      const stakeRegTx = await client0
        .newTx()
        .registerStake({ stakeCredential: address0.stakingCredential })
        .build()
        .then((b) => b.sign())
        .then((b) => b.submit())
      await client0.awaitTx(stakeRegTx, 1000)
    } catch {
      // Already registered
    }

    await new Promise((r) => setTimeout(r, 2_000))

    // Load governance_voting validator
    const voteScript = new PlutusV3.PlutusV3({
      bytes: Bytes.fromHex(loadValidator("governance_voting.governance_voting.vote"))
    })
    const scriptHash = ScriptHash.fromScript(voteScript)
    const drepCredential = new ScriptHash.ScriptHash({ hash: scriptHash.hash })

    // Register DRep (publish handler always succeeds)
    try {
      const drepRegTx = await client0
        .newTx()
        .registerDRep({
          drepCredential,
          anchor: makeAnchor("https://example.com/drep.json"),
          redeemer: Data.constr(0n, [Data.list([])])
        })
        .attachScript({ script: voteScript })
        .build()
        .then((b) => b.sign())
        .then((b) => b.submit())
      await client0.awaitTx(drepRegTx, 1000)
    } catch (e: any) {
      if (!e?.message?.includes("3152") && !e?.message?.includes("already known delegate")) {
        throw e
      }
    }

    await new Promise((r) => setTimeout(r, 2_000))

    // Create proposal
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

    // Create config UTxO with GovernanceConfig datum (no timelock)
    // GovernanceConfig { required_signers, quorum_threshold, vote_start_slot: None, vote_end_slot: None }
    const configDatum = Data.constr(0n, [
      Data.list([pkh0.hash, pkh1.hash]),
      Data.int(2n), // quorum_threshold
      Data.constr(1n, []), // None - no vote_start_slot
      Data.constr(1n, []) // None - no vote_end_slot
    ])
    const configTxHash = await client0
      .newTx()
      .payToAddress({
        address: address0,
        assets: Cardano.Assets.fromLovelace(5_000_000n),
        datum: new InlineDatum.InlineDatum({ data: configDatum })
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client0.awaitTx(configTxHash, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Find config UTxO
    const allUtxos = await client0.getUtxos(address0)
    const configUtxo = allUtxos.find(
      (u) =>
        Cardano.UTxO.toOutRefString(u).startsWith(TransactionHash.toHex(configTxHash)) &&
        u.assets.lovelace === 5_000_000n
    )
    if (!configUtxo) throw new Error("Config UTxO not found")

    // Build vote with quorum validation
    const voteRedeemer = Data.constr(0n, [Data.list([pkh0.hash, pkh1.hash])])
    const govActionId = new GovernanceAction.GovActionId({
      transactionId: proposeTx,
      govActionIndex: 0n
    })
    const scriptDRep = DRep.fromScriptHash(scriptHash)
    const votingProcedures = VotingProcedures.singleVote(
      new VotingProcedures.DRepVoter({ drep: scriptDRep }),
      govActionId,
      new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    )

    // Build tx with reference input and both signers
    const signBuilder = await client0
      .newTx()
      .vote({ votingProcedures, redeemer: voteRedeemer })
      .readFrom({ referenceInputs: [configUtxo] })
      .addSigner({ keyHash: pkh0 })
      .addSigner({ keyHash: pkh1 })
      .attachScript({ script: voteScript })
      .build()

    // Multi-sig
    const tx = await signBuilder.toTransaction()
    const witness0 = await signBuilder.partialSign()
    const witness1 = await client1.signTx(tx)
    const submitBuilder = await signBuilder.assemble([witness0, witness1])
    const voteTxHash = await submitBuilder.submit()

    expect(await client0.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("validates timelock-enabled voting", { timeout: 180_000 }, async () => {
    // Tests governance_voting with timelock configuration
    // Config includes vote_start_slot and vote_end_slot constraints

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

    // Load governance_voting validator
    const voteScript = new PlutusV3.PlutusV3({
      bytes: Bytes.fromHex(loadValidator("governance_voting.governance_voting.vote"))
    })
    const scriptHash = ScriptHash.fromScript(voteScript)
    const drepCredential = new ScriptHash.ScriptHash({ hash: scriptHash.hash })

    // DRep should already be registered from previous test, but try anyway
    try {
      const drepRegTx = await client0
        .newTx()
        .registerDRep({
          drepCredential,
          anchor: makeAnchor("https://example.com/drep.json"),
          redeemer: Data.constr(0n, [Data.list([])])
        })
        .attachScript({ script: voteScript })
        .build()
        .then((b) => b.sign())
        .then((b) => b.submit())
      await client0.awaitTx(drepRegTx, 1000)
    } catch {
      // Already registered
    }

    await new Promise((r) => setTimeout(r, 2_000))

    // Create proposal for this test
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address0.stakingCredential
    })
    const proposeTx = await client0
      .newTx()
      .propose({
        governanceAction: new GovernanceAction.InfoAction({}),
        rewardAccount,
        anchor: makeAnchor("https://example.com/timelock-proposal.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client0.awaitTx(proposeTx, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Configure timelock window using POSIX timestamps (milliseconds)
    // Cardano validity ranges use POSIX time, so the config must match
    const now = Time.now()
    const startTime = now - 30_000n // 30 seconds ago
    const endTime = now + 120_000n // 2 minutes from now

    // GovernanceConfig: { required_signers, quorum_threshold, vote_start_time, vote_end_time }
    const configDatum = Data.constr(0n, [
      Data.list([pkh0.hash, pkh1.hash]),
      Data.int(2n), // quorum_threshold
      Data.constr(0n, [Data.int(startTime)]), // Some(start_time)
      Data.constr(0n, [Data.int(endTime)]) // Some(end_time)
    ])

    // Create config UTxO
    const configTxHash = await client0
      .newTx()
      .payToAddress({
        address: address0,
        assets: Cardano.Assets.fromLovelace(5_000_000n),
        datum: new InlineDatum.InlineDatum({ data: configDatum })
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client0.awaitTx(configTxHash, 1000)).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))

    // Find config UTxO
    const allUtxos = await client0.getUtxos(address0)
    const configUtxo = allUtxos.find(
      (u) =>
        Cardano.UTxO.toOutRefString(u).startsWith(TransactionHash.toHex(configTxHash)) &&
        u.assets.lovelace === 5_000_000n
    )
    if (!configUtxo) throw new Error("Config UTxO not found")

    // Set validity interval within the timelock window (30 seconds)
    const validFrom = Time.now()
    const validTo = validFrom + 30_000n

    const voteRedeemer = Data.constr(0n, [Data.list([pkh0.hash, pkh1.hash])])
    const govActionId = new GovernanceAction.GovActionId({
      transactionId: proposeTx,
      govActionIndex: 0n
    })
    const scriptDRep = DRep.fromScriptHash(scriptHash)
    const votingProcedures = VotingProcedures.singleVote(
      new VotingProcedures.DRepVoter({ drep: scriptDRep }),
      govActionId,
      new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    )

    // Build tx with validity interval and reference input
    const signBuilder = await client0
      .newTx()
      .vote({ votingProcedures, redeemer: voteRedeemer })
      .readFrom({ referenceInputs: [configUtxo] })
      .setValidity({ from: validFrom, to: validTo })
      .addSigner({ keyHash: pkh0 })
      .addSigner({ keyHash: pkh1 })
      .attachScript({ script: voteScript })
      .build()

    // Multi-sig
    const tx = await signBuilder.toTransaction()
    const witness0 = await signBuilder.partialSign()
    const witness1 = await client1.signTx(tx)
    const submitBuilder = await signBuilder.assemble([witness0, witness1])
    const voteTxHash = await submitBuilder.submit()

    expect(await client0.awaitTx(voteTxHash, 1000)).toBe(true)
  })
})
