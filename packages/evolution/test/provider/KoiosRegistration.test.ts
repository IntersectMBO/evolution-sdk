/**
 * Koios reports stake-key registration as `status`, and the account-info schema did not ask for
 * it — so a registered account that had not delegated was indistinguishable from one that was
 * never registered. Both report `delegated_pool: null` and no rewards.
 *
 * CIP-95's `getRegisteredPubStakeKeys` / `getUnregisteredPubStakeKeys` split is exactly that
 * question, and a dApp reads it to decide whether a vote-delegation certificate needs a
 * registration certificate beside it.
 */
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as RewardAddress from "../../src/RewardAddress.js"
import * as KoiosEffect from "../../src/sdk/provider/internal/KoiosEffect.js"

const BASE_URL = "https://koios.test/api/v1"
const STAKE = "stake_test1uqrw9tjymlm8wrwq7jk68n6v7fs9qz8z0tkdkve26dylmfs2x4gcg"

const stubAccountInfo = (row: Record<string, unknown>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify([row]), { status: 200, headers: { "content-type": "application/json" } }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const delegationOf = (row: Record<string, unknown>) => {
  stubAccountInfo(row)
  return Effect.runPromise(KoiosEffect.getDelegation(BASE_URL)(RewardAddress.RewardAddress.make(STAKE)))
}

describe("Koios stake-key registration", () => {
  it("reports a registered account that has not delegated", async () => {
    const delegation = await delegationOf({
      status: "registered",
      delegated_pool: null,
      rewards_available: "0"
    })
    expect(delegation.poolId).toBeNull()
    expect(delegation.registered).toBe(true)
  })

  it("distinguishes it from one that was never registered", async () => {
    const delegation = await delegationOf({
      status: "not registered",
      delegated_pool: null,
      rewards_available: "0"
    })
    expect(delegation.poolId).toBeNull()
    expect(delegation.registered).toBe(false)
  })

  it("leaves it absent when the deployment does not send the field", async () => {
    // Older Koios deployments omit `status`. Absent is the honest answer: "not registered" is a
    // factual claim and guessing it builds a transaction the node rejects.
    const delegation = await delegationOf({ delegated_pool: null, rewards_available: "0" })
    expect(delegation.registered).toBeUndefined()
  })
})
