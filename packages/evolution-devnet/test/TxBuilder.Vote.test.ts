/**
 * Devnet tests for TxBuilder vote operations (script-free).
 * Tests governance voting and proposals using the SDK.
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Constitution from "@evolution-sdk/evolution/Constitution"
import * as DRep from "@evolution-sdk/evolution/DRep"
import * as GovernanceAction from "@evolution-sdk/evolution/GovernanceAction"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as ProtocolParamUpdate from "@evolution-sdk/evolution/ProtocolParamUpdate"
import * as ProtocolVersion from "@evolution-sdk/evolution/ProtocolVersion"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import * as UnitInterval from "@evolution-sdk/evolution/UnitInterval"
import * as Url from "@evolution-sdk/evolution/Url"
import * as VotingProcedures from "@evolution-sdk/evolution/VotingProcedures"
import { inject } from "vitest"

import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

describe("TxBuilder Vote Operations (script-free)", () => {
  let shared: SharedClusterResult

  beforeAll(async () => {
    shared = await useSharedCluster(inject("sharedCluster" as any), [27, 28, 29, 30])
  }, 180_000)

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
    const PROPOSER_ACCOUNT = 27

    const proposerUtxo = shared.getGenesisUtxo(PROPOSER_ACCOUNT)

    const proposerClient = shared.makeClient(PROPOSER_ACCOUNT)

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
    const client = shared.makeClient(27)
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

    // Use account 27 as voter for this simple test
    const VOTER_ACCOUNT = 27
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({ drepCredential: voterAddress.paymentCredential, anchor: createAnchor("info-voter-drep.json") })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
    const client = shared.makeClient(27)
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

    // Use account 28 as voter for NoConfidenceAction
    const VOTER_ACCOUNT = 28
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("no-confidence-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
    const client = shared.makeClient(27)
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

    // Use account 29 as voter for HardForkInitiationAction
    const VOTER_ACCOUNT = 29
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("hardfork-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
    const client = shared.makeClient(27)
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

    // Use account 30 as voter for TreasuryWithdrawalsAction
    const VOTER_ACCOUNT = 30
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("treasury-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
    const client = shared.makeClient(27)
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

    // Use account 27 as voter for UpdateCommitteeAction
    const VOTER_ACCOUNT = 27
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("update-committee-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
    const client = shared.makeClient(27)
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

    // Use account 28 as voter for NewConstitutionAction
    const VOTER_ACCOUNT = 28
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({
          drepCredential: voterAddress.paymentCredential,
          anchor: createAnchor("constitution-voter-drep.json")
        })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
    const client = shared.makeClient(27)
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

    // Ensure a key-based DRep exists for account 28 (voter)
    const VOTER_ACCOUNT = 28
    const voterClient = shared.makeClient(VOTER_ACCOUNT)
    const voterAddress = await voterClient.address()
    const voterUtxo = shared.getGenesisUtxo(VOTER_ACCOUNT)

    try {
      const drepRegHash = await voterClient
        .newTx()
        .registerDRep({ drepCredential: voterAddress.paymentCredential, anchor: createAnchor("voter-drep.json") })
        .build({ availableUtxos: [voterUtxo] })
        .then((b) => b.sign())
        .then((b) => b.submit())
      await voterClient.awaitTx(drepRegHash, 1000)
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
