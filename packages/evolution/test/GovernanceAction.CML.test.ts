import { Equal } from "effect"
import { describe, expect, test } from "vitest"

import type * as Coin from "../src/Coin.js"
import * as Credential from "../src/Credential.js"
import type * as EpochNo from "../src/EpochNo.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as KeyHash from "../src/KeyHash.js"
import * as RewardAccount from "../src/RewardAccount.js"
import * as ScriptHash from "../src/ScriptHash.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as UnitInterval from "../src/UnitInterval.js"
import { CborReader } from "../src/v2/CborReader.js"
import { CborWriter } from "../src/v2/CborWriter.js"

describe("GovernanceAction Map types CBOR round-trip", () => {
  test("TreasuryWithdrawalsAction with Map<RewardAccount, Coin> should round-trip correctly", () => {
    const iterations = 100

    for (let i = 0; i < iterations; i++) {
      // Create a TreasuryWithdrawalsAction with withdrawals Map
      const withdrawals = new Map<RewardAccount.RewardAccount, Coin.Coin>([
        [
          RewardAccount.RewardAccount.make({
            networkId: 0, // Testnet
            stakeCredential: KeyHash.fromBytes(new Uint8Array(28).fill(i % 256))
          }),
          BigInt(1000000 + i)
        ],
        [
          RewardAccount.RewardAccount.make({
            networkId: 0, // Testnet
            stakeCredential: KeyHash.fromBytes(new Uint8Array(28).fill((i + 1) % 256))
          }),
          BigInt(2000000 + i)
        ]
      ])

      const policyHash = i % 2 === 0 ? new ScriptHash.ScriptHash({ hash: new Uint8Array(28).fill(i % 256) }) : null

      const original = new GovernanceAction.TreasuryWithdrawalsAction({
        withdrawals,
        policyHash
      })

      // Encode to CBOR via CborWriter
      const w = new CborWriter(256)
      GovernanceAction.write(w, original)
      const bytes = w.finishView()

      // Decode back via CborReader
      const decoded = GovernanceAction.read(new CborReader(bytes))

      // Check equality using Effect's Equal
      expect(Equal.equals(original, decoded)).toBe(true)
    }
  })

  test("UpdateCommitteeAction with Map<Credential, EpochNo> should round-trip correctly", () => {
    const iterations = 100

    for (let i = 0; i < iterations; i++) {
      // Create membersToAdd Map
      const membersToAdd = new Map<Credential.CredentialSchema, EpochNo.EpochNo>([
        [Credential.makeKeyHash(new Uint8Array(28).fill(i % 256)), BigInt(100 + i)],
        [Credential.makeKeyHash(new Uint8Array(28).fill((i + 1) % 256)), BigInt(200 + i)]
      ])

      const membersToRemove = [Credential.makeKeyHash(new Uint8Array(28).fill((i + 2) % 256))]

      const threshold = new UnitInterval.UnitInterval({
        numerator: BigInt(2),
        denominator: BigInt(3)
      })

      const govActionId =
        i % 2 === 0
          ? null
          : new GovernanceAction.GovActionId({
              transactionId: new TransactionHash.TransactionHash({
                hash: new Uint8Array(32).fill(i % 256)
              }),
              govActionIndex: BigInt(i % 65536)
            })

      const original = new GovernanceAction.UpdateCommitteeAction({
        govActionId,
        membersToRemove,
        membersToAdd,
        threshold
      })

      // Encode to CBOR via CborWriter
      const w = new CborWriter(256)
      GovernanceAction.write(w, original)
      const bytes = w.finishView()

      // Decode back via CborReader
      const decoded = GovernanceAction.read(new CborReader(bytes))

      // Check equality using Effect's Equal
      expect(Equal.equals(original, decoded)).toBe(true)
    }
  })
})
