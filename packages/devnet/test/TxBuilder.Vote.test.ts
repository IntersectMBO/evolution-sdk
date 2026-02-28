/**
 * Devnet tests for TxBuilder vote operations (script-free).
 * Tests governance voting and proposals using the SDK.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Constitution from "@evolution-sdk/evolution/Constitution"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as GovernanceAction from "@evolution-sdk/evolution/GovernanceAction"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as ProtocolParamUpdate from "@evolution-sdk/evolution/ProtocolParamUpdate"
import * as ProtocolVersion from "@evolution-sdk/evolution/ProtocolVersion"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as UnitInterval from "@evolution-sdk/evolution/UnitInterval"
import * as Url from "@evolution-sdk/evolution/Url"
import * as VotingProcedures from "@evolution-sdk/evolution/VotingProcedures"

describe("TxBuilder Vote Operations (script-free)", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisConfig: Config.ShelleyGenesis
  let conwayGenesis: Config.ConwayGenesis
  const genesisUtxosByAccount: Map<number, Cardano.UTxO.UTxO> = new Map()

  const TEST_MNEMONIC =
    "test test test test test test test test test test test test test test test test test test test test test test test sauce"

  const createTestClient = (accountIndex: number = 0) =>
    createClient({
      network: 0,
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

  beforeAll(async () => {
    // Create clients for multiple test accounts
    const accounts = [0, 1, 2, 3].map((accountIndex) =>
      createClient({
        network: 0,
        wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" }
      })
    )

    const addresses = await Promise.all(accounts.map((client) => client.address()))
    const addressHexes = addresses.map((addr) => Address.toHex(addr))

    genesisConfig = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: {
        [addressHexes[0]]: 500_000_000_000,
        [addressHexes[1]]: 500_000_000_000,
        [addressHexes[2]]: 500_000_000_000,
        [addressHexes[3]]: 500_000_000_000
      }
    }

    conwayGenesis = Config.DEFAULT_CONWAY_GENESIS

    const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)

    for (let i = 0; i < addresses.length; i++) {
      const utxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(addresses[i]))
      if (utxo) genesisUtxosByAccount.set(i, utxo)
    }

    devnetCluster = await Cluster.make({
      clusterName: "vote-test",
      ports: { node: 6010, submit: 9010 },
      shelleyGenesis: genesisConfig,
      conwayGenesis,
      kupo: { enabled: true, port: 1453, logLevel: "Info" },
      ogmios: { enabled: true, port: 1343, logLevel: "info" }
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

  // Helper to create anchor for governance actions
  const createAnchor = (
    path: string,
    hashHex: string = "1111111111111111111111111111111111111111111111111111111111111111"
  ) =>
    new Anchor.Anchor({
      anchorUrl: new Url.Url({ href: `https://example.com/${path}` }),
      anchorDataHash: Bytes32.fromHex(hashHex)
    })

  it("registers key DRep, creates proposal, and tests vote operation structure", { timeout: 180_000 }, async () => {
    const PROPOSER_ACCOUNT = 0

    const proposerUtxo = genesisUtxosByAccount.get(PROPOSER_ACCOUNT)

    if (!proposerUtxo) {
      throw new Error("Genesis UTxOs not found")
    }

    const proposerClient = createTestClient(PROPOSER_ACCOUNT)

    const proposerAddress = await proposerClient.address()
    const proposerCredential = proposerAddress.paymentCredential

    // Step 1: Register key-based DRep (proposer)
    const proposerAnchor = createAnchor(
      "proposer-drep.json",
      "0000000000000000000000000000000000000000000000000000000000000000"
    )

    try {
      const registerProposerTxHash = await proposerClient
        .newTx()
        .registerDRep({ drepCredential: proposerCredential, anchor: proposerAnchor })
        .build({ availableUtxos: [proposerUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())

      expect(await proposerClient.awaitTx(registerProposerTxHash, 1000)).toBe(true)
    } catch (error: any) {
      if (error.message?.includes("already known delegate representative") || error.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw error
      }
    }

    // Register stake credential (required for proposals in Conway era)
    if (!proposerAddress.stakingCredential) {
      throw new Error("Proposer address must have staking credential for reward account")
    }

    try {
      const registerStakeTxHash = await proposerClient
        .newTx()
        .registerStake({ stakeCredential: proposerAddress.stakingCredential })
        .build()
        .then((b) => b.sign())
        .then((b) => b.submit())
      expect(await proposerClient.awaitTx(registerStakeTxHash, 1000)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error: any) {
      if (!error.message?.includes("already known stake credential")) {
        throw error
      }
      // Stake credential already registered, continue
    }

    // Step 2: Create a governance proposal (InfoAction is simplest - just for information)
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: proposerAddress.stakingCredential
    })

    const infoAction = new GovernanceAction.InfoAction({})
    const proposalAnchor = createAnchor(
      "proposal.json",
      "2222222222222222222222222222222222222222222222222222222222222222"
    )

    const proposeTxHash = await proposerClient
      .newTx()
      .propose({
        governanceAction: infoAction,
        rewardAccount,
        anchor: proposalAnchor
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await proposerClient.awaitTx(proposeTxHash, 1000)).toBe(true)

    const govActionId = new GovernanceAction.GovActionId({
      transactionId: proposeTxHash,
      govActionIndex: 0n
    })

    // Step 3: Vote on the proposal using the key-based DRep
    if (!(proposerCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Expected proposer credential to be a KeyHash")
    }
    const keyDRep = DRep.fromKeyHash(proposerCredential)
    const voter = new VotingProcedures.DRepVoter({ drep: keyDRep })

    const votingProcedure = new VotingProcedures.VotingProcedure({
      vote: VotingProcedures.yes(),
      anchor: null
    })

    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, votingProcedure)

    const voteTxHash = await proposerClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await proposerClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates InfoAction proposal (type 6)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const infoAction = new GovernanceAction.InfoAction({})

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: infoAction,
        rewardAccount,
        anchor: createAnchor("info-action.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created InfoAction proposal using a key-based DRep ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Use account 0 as voter for this simple test
    const VOTER_ACCOUNT = 0
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found for InfoAction vote")

    try {
      await voterClient
        .newTx()
        .registerDRep({ drepCredential: voterAddress.paymentCredential, anchor: createAnchor("info-voter-drep.json") })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash for InfoAction vote")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates NoConfidenceAction proposal (type 3)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const noConfidenceAction = new GovernanceAction.NoConfidenceAction({
      govActionId: null
    })

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: noConfidenceAction,
        rewardAccount,
        anchor: createAnchor("no-confidence.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created NoConfidenceAction proposal ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Use account 1 as voter for NoConfidenceAction
    const VOTER_ACCOUNT = 1
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found for NoConfidenceAction vote")

    try {
      await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("no-confidence-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash for NoConfidenceAction vote")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates HardForkInitiationAction proposal (type 1)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const hardForkAction = new GovernanceAction.HardForkInitiationAction({
      govActionId: null,
      protocolVersion: new ProtocolVersion.ProtocolVersion({ major: 11n, minor: 0n })
    })

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: hardForkAction,
        rewardAccount,
        anchor: createAnchor("hard-fork.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created HardForkInitiationAction proposal ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Use account 2 as voter for HardForkInitiationAction
    const VOTER_ACCOUNT = 2
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found for HardForkInitiationAction vote")

    try {
      await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("hardfork-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash for HardForkInitiationAction vote")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates TreasuryWithdrawalsAction proposal (type 2)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const withdrawals = new Map<RewardAccount.RewardAccount, bigint>()
    withdrawals.set(rewardAccount, 1_000_000_000n) // 1000 ADA

    const treasuryAction = new GovernanceAction.TreasuryWithdrawalsAction({
      withdrawals,
      policyHash: null
    })

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: treasuryAction,
        rewardAccount,
        anchor: createAnchor("treasury-withdrawal.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created TreasuryWithdrawalsAction proposal ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Use account 3 as voter for TreasuryWithdrawalsAction
    const VOTER_ACCOUNT = 3
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found for TreasuryWithdrawalsAction vote")

    try {
      await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("treasury-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash for TreasuryWithdrawalsAction vote")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates UpdateCommitteeAction proposal (type 4)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const updateCommitteeAction = new GovernanceAction.UpdateCommitteeAction({
      govActionId: null,
      membersToRemove: [],
      membersToAdd: new Map(),
      threshold: new UnitInterval.UnitInterval({ numerator: 2n, denominator: 3n })
    })

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: updateCommitteeAction,
        rewardAccount,
        anchor: createAnchor("update-committee.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created UpdateCommitteeAction proposal ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Use account 0 as voter for UpdateCommitteeAction
    const VOTER_ACCOUNT = 0
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found for UpdateCommitteeAction vote")

    try {
      await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("update-committee-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash for UpdateCommitteeAction vote")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates NewConstitutionAction proposal (type 5)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const constitutionAnchor = createAnchor(
      "constitution.json",
      "3333333333333333333333333333333333333333333333333333333333333333"
    )
    const constitution = new Constitution.Constitution({
      anchor: constitutionAnchor,
      scriptHash: null
    })

    const newConstitutionAction = new GovernanceAction.NewConstitutionAction({
      govActionId: null,
      constitution
    })

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: newConstitutionAction,
        rewardAccount,
        anchor: createAnchor("new-constitution-proposal.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created NewConstitutionAction proposal ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Use account 1 as voter for NewConstitutionAction
    const VOTER_ACCOUNT = 1
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found for NewConstitutionAction vote")

    try {
      await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("constitution-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash for NewConstitutionAction vote")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })

  it("creates ParameterChangeAction proposal (type 0)", { timeout: 60_000 }, async () => {
    const client = createTestClient(0)
    const address = await client.address()

    if (!address.stakingCredential) {
      throw new Error("Address must have staking credential")
    }
    const rewardAccount = new RewardAccount.RewardAccount({
      networkId: 0,
      stakeCredential: address.stakingCredential
    })

    const paramUpdate = new ProtocolParamUpdate.ProtocolParamUpdate({
      maxTxSize: 32768n
    })

    const parameterChangeAction = new GovernanceAction.ParameterChangeAction({
      govActionId: null,
      protocolParamUpdate: paramUpdate,
      policyHash: null
    })

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: parameterChangeAction,
        rewardAccount,
        anchor: createAnchor("parameter-change.json")
      })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)

    // --- Now vote on the newly created proposal using a key-based DRep ---
    const govActionIdLocal = new GovernanceAction.GovActionId({
      transactionId: txHash,
      govActionIndex: 0n
    })

    // Ensure a key-based DRep exists for account 1 (voter)
    const VOTER_ACCOUNT = 1
    const voterClient = createTestClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = genesisUtxosByAccount.get(VOTER_ACCOUNT)

    if (!voterUtxo) throw new Error("Voter genesis UTxO not found")

    try {
      await voterClient
        .newTx()
        .registerDRep({ drepCredential: voterAddress.paymentCredential, anchor: createAnchor("voter-drep.json") })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
    } catch (err: any) {
      if (err.message?.includes("already known delegate representative") || err.message?.includes("re-register")) {
        // DRep already registered, continue
      } else {
        throw err
      }
    }

    if (!(voterAddress.paymentCredential instanceof KeyHash.KeyHash)) {
      throw new Error("Voter payment credential not a KeyHash")
    }

    const voterDRep = DRep.fromKeyHash(voterAddress.paymentCredential)
    const drepVoter = new VotingProcedures.DRepVoter({ drep: voterDRep })

    const voteProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })
    const votingProcedures = VotingProcedures.singleVote(drepVoter, govActionIdLocal, voteProcedure)

    const voteTxHash = await voterClient
      .newTx()
      .vote({ votingProcedures })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await voterClient.awaitTx(voteTxHash, 1000)).toBe(true)
  })
})
