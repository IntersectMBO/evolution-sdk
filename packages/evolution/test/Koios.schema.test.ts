import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { TxInfoSchema } from "../src/sdk/provider/internal/Koios.js"

// Minimal valid TxInfoSchema payload — only fields needed to exercise the new structs
const baseTxInfo = {
  tx_hash: "d10133964da9e443b303917fd0b7644ae3d01c133deff85b4f59416c2d00f530",
  block_hash: "f144a8264acf4bdfe2e1241170969c930d64ab6b0996a4a45237b623f1dd670e",
  block_height: 5385757,
  epoch_no: 250,
  epoch_slot: 142,
  absolute_slot: 22636942,
  tx_timestamp: 1614203233,
  tx_block_index: 0,
  tx_size: 512,
  total_output: "157832856",
  fee: "172101",
  treasury_donation: "0",
  deposit: "0",
  invalid_before: null,
  invalid_after: null,
  collateral_inputs: null,
  collateral_output: null,
  reference_inputs: null,
  inputs: [],
  outputs: [],
  withdrawals: null,
  assets_minted: null,
  metadata: null,
  certificates: null,
  native_scripts: null,
  plutus_contracts: null,
  voting_procedures: null,
  proposal_procedures: null
}

describe("Koios TxInfoSchema — voting_procedures & proposal_procedures", () => {
  describe("voting_procedures", () => {
    it("accepts null", () => {
      const result = Schema.decodeUnknownSync(TxInfoSchema)({ ...baseTxInfo, voting_procedures: null })
      expect(result.voting_procedures).toBeNull()
    })

    it("accepts a valid voting procedure array", () => {
      const votingProcedures = [
        {
          proposal_tx_hash: "d10133964da9e443b303917fd0b7644ae3d01c133deff85b4f59416c2d00f530",
          proposal_index: 0,
          voter_role: "DRep" as const,
          voter: "drep1yfhyq6tztjksqqpd5lglc3zr2tn8vylgjh9xzz7n2p4l4lgk3qam3",
          voter_hex: "6e4069625cad00002da7d1fc444352e67613e895ca610bd3506bfafd",
          vote: "Yes" as const
        }
      ]
      const result = Schema.decodeUnknownSync(TxInfoSchema)({ ...baseTxInfo, voting_procedures: votingProcedures })
      expect(result.voting_procedures).toHaveLength(1)
      expect(result.voting_procedures![0].voter_role).toBe("DRep")
      expect(result.voting_procedures![0].vote).toBe("Yes")
    })

    it("accepts all valid voter_role values", () => {
      const roles = ["DRep", "SPO", "ConstitutionalCommittee"] as const
      for (const voter_role of roles) {
        const result = Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          voting_procedures: [
            {
              proposal_tx_hash: "abc123",
              proposal_index: 0,
              voter_role,
              voter: "voter",
              voter_hex: "abcd",
              vote: "No"
            }
          ]
        })
        expect(result.voting_procedures![0].voter_role).toBe(voter_role)
      }
    })

    it("accepts all valid vote values", () => {
      const votes = ["Yes", "No", "Abstain"] as const
      for (const vote of votes) {
        const result = Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          voting_procedures: [
            {
              proposal_tx_hash: "abc",
              proposal_index: 0,
              voter_role: "SPO",
              voter: "v",
              voter_hex: "ff",
              vote
            }
          ]
        })
        expect(result.voting_procedures![0].vote).toBe(vote)
      }
    })

    it("rejects an unknown voter_role", () => {
      expect(() =>
        Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          voting_procedures: [
            {
              proposal_tx_hash: "abc",
              proposal_index: 0,
              voter_role: "InvalidRole", // not in the literal union
              voter: "v",
              voter_hex: "ff",
              vote: "Yes"
            }
          ]
        })
      ).toThrow()
    })

    it("rejects an unknown vote value", () => {
      expect(() =>
        Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          voting_procedures: [
            {
              proposal_tx_hash: "abc",
              proposal_index: 0,
              voter_role: "DRep",
              voter: "v",
              voter_hex: "ff",
              vote: "Maybe" // not Yes/No/Abstain
            }
          ]
        })
      ).toThrow()
    })
  })

  describe("proposal_procedures", () => {
    it("accepts null", () => {
      const result = Schema.decodeUnknownSync(TxInfoSchema)({ ...baseTxInfo, proposal_procedures: null })
      expect(result.proposal_procedures).toBeNull()
    })

    it("accepts a valid InfoAction proposal", () => {
      const proposals = [
        {
          index: 0,
          type: "InfoAction" as const,
          description: { tag: "InfoAction" },
          deposit: "100000000000",
          return_address: "stake1uy6yzwsxxc28lfms0qmpxvyz9a7y770rtcqx9y96m42cttqwvp4m5",
          expiration: 680,
          meta_url: "https://example.com/meta.json",
          meta_hash: "dc208474e195442d07a5b6d42af19bb2db02229427dfb53ab23122e6b0e2487d",
          withdrawal: null,
          param_proposal: null
        }
      ]
      const result = Schema.decodeUnknownSync(TxInfoSchema)({ ...baseTxInfo, proposal_procedures: proposals })
      expect(result.proposal_procedures).toHaveLength(1)
      expect(result.proposal_procedures![0].type).toBe("InfoAction")
      expect(result.proposal_procedures![0].expiration).toBe(680)
    })

    it("accepts a TreasuryWithdrawals proposal with withdrawal array", () => {
      const proposals = [
        {
          index: 0,
          type: "TreasuryWithdrawals" as const,
          description: { tag: "TreasuryWithdrawals" },
          deposit: "100000000000",
          return_address: "stake1uy6yzwsxxc28lfms0qmpxvyz9a7y770rtcqx9y96m42cttqwvp4m5",
          expiration: null,
          meta_url: null,
          meta_hash: null,
          withdrawal: [
            {
              stake_address: "stake1uy6yzwsxxc28lfms0qmpxvyz9a7y770rtcqx9y96m42cttqwvp4m5",
              amount: "31235800000"
            }
          ],
          param_proposal: null
        }
      ]
      const result = Schema.decodeUnknownSync(TxInfoSchema)({ ...baseTxInfo, proposal_procedures: proposals })
      expect(result.proposal_procedures![0].withdrawal).toHaveLength(1)
      expect(result.proposal_procedures![0].withdrawal![0].amount).toBe("31235800000")
    })

    it("accepts all valid proposal types", () => {
      const types = [
        "ParameterChange",
        "HardForkInitiation",
        "TreasuryWithdrawals",
        "NoConfidence",
        "NewCommittee",
        "NewConstitution",
        "InfoAction"
      ] as const

      for (const type of types) {
        const result = Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          proposal_procedures: [
            {
              index: 0,
              type,
              description: {},
              deposit: "100000000000",
              return_address: "stake1abc",
              expiration: null,
              meta_url: null,
              meta_hash: null,
              withdrawal: null,
              param_proposal: null
            }
          ]
        })
        expect(result.proposal_procedures![0].type).toBe(type)
      }
    })

    it("rejects an unknown proposal type", () => {
      expect(() =>
        Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          proposal_procedures: [
            {
              index: 0,
              type: "UnknownProposalType", // not in the literal union
              description: {},
              deposit: "100000000000",
              return_address: "stake1abc",
              expiration: null,
              meta_url: null,
              meta_hash: null,
              withdrawal: null,
              param_proposal: null
            }
          ]
        })
      ).toThrow()
    })

    it("rejects missing required field (deposit)", () => {
      expect(() =>
        Schema.decodeUnknownSync(TxInfoSchema)({
          ...baseTxInfo,
          proposal_procedures: [
            {
              index: 0,
              type: "InfoAction",
              description: {},
              // deposit is missing
              return_address: "stake1abc",
              expiration: null,
              meta_url: null,
              meta_hash: null,
              withdrawal: null,
              param_proposal: null
            }
          ]
        })
      ).toThrow()
    })
  })
})
