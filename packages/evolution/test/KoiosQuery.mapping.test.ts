import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect, Either } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAssets from "../src/Assets.js"
import * as _Koios from "../src/sdk/provider/internal/Koios.js"
import * as KoiosQuery from "../src/sdk/provider/internal/KoiosQuery.js"

/**
 * The half of the Koios query tier the cip139 differential cannot reach: it supplies
 * `ChainParameters` directly, so the mapping FROM the backend document is only checked here.
 */

const frac = (i: { numerator: bigint; denominator: bigint }) => `${i.numerator}/${i.denominator}`

/** A `/cli_protocol_params` document, abridged to the fields the mapping reads. */
const CLI_DOC = {
  poolVotingThresholds: {
    motionNoConfidence: 0.51,
    committeeNormal: 0.52,
    committeeNoConfidence: 0.53,
    hardForkInitiation: 0.54,
    ppSecurityGroup: 0.55
  },
  dRepVotingThresholds: {
    motionNoConfidence: 0.61,
    committeeNormal: 0.62,
    committeeNoConfidence: 0.63,
    updateToConstitution: 0.64,
    hardForkInitiation: 0.65,
    ppNetworkGroup: 0.66,
    ppEconomicGroup: 0.67,
    ppTechnicalGroup: 0.68,
    ppGovGroup: 0.69,
    treasuryWithdrawal: 0.7
  },
  committeeMinSize: 5,
  committeeMaxTermLength: 146,
  govActionLifetime: 6,
  govActionDeposit: 100000000000,
  dRepActivity: 20,
  maxBlockBodySize: 90112,
  maxBlockHeaderSize: 1100,
  poolRetireMaxEpoch: 18,
  stakePoolTargetNum: 500,
  poolPledgeInfluence: 0.3,
  monetaryExpansion: 0.003,
  treasuryCut: 0.2,
  minPoolCost: 170000000,
  maxTxExecutionUnits: { memory: 14000000, steps: 10000000000 },
  maxBlockExecutionUnits: { memory: 62000000, steps: 20000000000 },
  protocolVersion: { major: 10, minor: 0 },
  // The `cardano-cli` document spells the prices as an object rather than a decimal; both
  // forms appear in the wild and both have to land on the same rational.
  executionUnitPrices: { priceMemory: { numerator: 577, denominator: 10000 }, priceSteps: 0.0000721 },
  minFeeRefScriptCostPerByte: 15,
  costModels: { PlutusV1: [100788, 420], PlutusV2: [100788, 421], PlutusV3: [100788, 422] }
}

describe("toChainParameters", () => {
  const mapped = KoiosQuery.toChainParameters(CLI_DOC as Record<string, unknown>)

  // ORDER IS THE SCHEMA. The document names its thresholds; the CDDL arrays do not, so a
  // mis-ordered map yields plausible, wrong numbers that nothing downstream can catch.
  it("puts the pool thresholds in CDDL order", () => {
    expect(mapped.poolVotingThresholds.map(frac)).toEqual(["51/100", "13/25", "53/100", "27/50", "11/20"])
  })

  it("puts the DRep thresholds in CDDL order", () => {
    expect(mapped.drepVotingThresholds.map(frac)).toEqual([
      "61/100",
      "31/50",
      "63/100",
      "16/25",
      "13/20",
      "33/50",
      "67/100",
      "17/25",
      "69/100",
      "7/10"
    ])
  })

  it("reads both rational forms exactly, never through a float", () => {
    // The object form is taken as given; the decimal form is parsed as a string and reduced.
    expect(frac(mapped.executionPrices.mem)).toBe("577/10000")
    expect(frac(mapped.executionPrices.step)).toBe("721/10000000")
    expect(frac(mapped.minFeeRefScriptCostPerByte)).toBe("15/1")
    expect(frac(mapped.poolPledgeInfluence)).toBe("3/10")
    expect(frac(mapped.monetaryExpansion)).toBe("3/1000")
    expect(frac(mapped.treasuryCut)).toBe("1/5")
  })

  it("keeps the cost models as ordered integers", () => {
    expect(mapped.plutusV1CostModel).toEqual([100788n, 420n])
    expect(mapped.plutusV3CostModel).toEqual([100788n, 422n])
  })

  it("carries the execution-unit bounds and the protocol version", () => {
    expect([mapped.maxTxExMem, mapped.maxTxExSteps]).toEqual([14_000_000n, 10_000_000_000n])
    expect([mapped.maxBlockExMem, mapped.maxBlockExSteps]).toEqual([62_000_000n, 20_000_000_000n])
    expect([mapped.protocolVersion.major, mapped.protocolVersion.minor]).toEqual([10n, 0n])
  })

  it("refuses a document missing a threshold rather than defaulting it", () => {
    const { ppSecurityGroup: _dropped, ...short } = CLI_DOC.poolVotingThresholds
    expect(() =>
      KoiosQuery.toChainParameters({ ...CLI_DOC, poolVotingThresholds: short } as Record<string, unknown>)
    ).toThrow(/poolVotingThresholds.ppSecurityGroup/)
  })

  it("refuses a missing integer rather than reporting zero", () => {
    const { committeeMinSize: _omitted, ...short } = CLI_DOC
    expect(() => KoiosQuery.toChainParameters(short as Record<string, unknown>)).toThrow(/committeeMinSize/)
  })
})

describe("getChainParameters over the wire", () => {
  /**
   * ⚠️ Driven through `HttpUtils`, against a REAL preprod `/cli_protocol_params` document, because
   * the mapping tests above cannot reach this failure. `HttpUtils` parses with a reviver that hands
   * every number to the schema as the exact text the server wrote — so on the wire
   * `committeeMinSize` is `"3"`, while a hand-built fixture gives `3`. A helper demanding a
   * `number` therefore passed every test and failed every live request, which is what it did.
   */
  const LIVE = readFileSync(
    join(import.meta.dirname, "provider", "fixtures", "koios", "cli_protocol_params.json"),
    "utf8"
  )

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("decodes the document Koios actually serves", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(LIVE, { status: 200, headers: { "Content-Type": "application/json" } })
    )

    const params = await Effect.runPromise(KoiosQuery.getChainParameters("https://koios.test/api/v1")())

    // The integer fields the reviver turns into strings.
    expect(params.committeeMinSize).toBe(3)
    expect(params.committeeMaxTermLength).toBe(146)
    expect(params.maxBlockBodySize).toBeGreaterThan(0)
    // The rationals, still exact.
    expect(params.treasuryCut.denominator).toBeGreaterThan(0n)
    expect(params.executionPrices.mem.numerator).toBeGreaterThan(0n)
    // The uint64 amounts the reviver exists to protect.
    expect(params.govActionDeposit).toBeGreaterThan(0n)
    expect(params.minPoolCost).toBeGreaterThan(0n)
    expect(params.protocolVersion.major).toBeGreaterThan(0n)
  })
})

describe("toPoolSummary", () => {
  // ⚠️ Two different absences. A row that LACKS `live_stake` came from a listing that cannot
  // report it; a row that HAS it as `null` is a pool with none. Reading null as unknown made
  // "all pools" fail on any chain containing a retired pool, which is all of them.
  it("tells a missing column from a null value", () => {
    expect(
      KoiosQuery.toPoolSummary({ pool_id_bech32: "pool1a", pool_status: "registered", active_stake: 5n }).liveStake
    ).toBeUndefined()
    expect(
      KoiosQuery.toPoolSummary({
        pool_id_bech32: "pool1b",
        pool_status: "retired",
        active_stake: null,
        live_stake: null
      })
    ).toEqual({ poolId: "pool1b", status: "retired", activeStake: 0n, liveStake: 0n })
  })
})

describe("toProposalSummary", () => {
  it("leaves a pending action's epochs absent rather than zero", () => {
    expect(
      KoiosQuery.toProposalSummary({
        proposal_id: "gov1",
        ratified_epoch: null,
        enacted_epoch: null,
        expired_epoch: null,
        expiration: null
      })
    ).toEqual({ proposalId: "gov1" })
  })

  it("carries every epoch it is given, including zero", () => {
    expect(KoiosQuery.toProposalSummary({ proposal_id: "gov2", ratified_epoch: 0, expiration: 4 })).toEqual({
      proposalId: "gov2",
      ratifiedEpoch: 0,
      expiration: 4
    })
  })
})

describe("toAccountInfo", () => {
  it("reports an unreported deposit as absent, not as zero", () => {
    expect(
      KoiosQuery.toAccountInfo({
        status: "registered",
        delegated_pool: null,
        delegated_drep: null,
        rewards_available: 0n
      })
    ).toEqual({
      registered: true,
      delegatedPool: null,
      delegatedDRep: null,
      rewardsAvailable: 0n,
      deposit: undefined,
      controlledBalance: undefined
    })
  })

  it("keeps the predefined vote-delegation targets in the backend's vocabulary", () => {
    expect(
      KoiosQuery.toAccountInfo({
        status: "registered",
        delegated_pool: "pool1a",
        delegated_drep: "drep_always_abstain",
        rewards_available: 7n,
        deposit: 2_000_000n,
        total_balance: 9n
      })
    ).toEqual({
      registered: true,
      delegatedPool: "pool1a",
      delegatedDRep: "drep_always_abstain",
      rewardsAvailable: 7n,
      deposit: 2_000_000n,
      controlledBalance: 9n
    })
  })

  it("an account the backend does not call registered is not registered", () => {
    expect(
      KoiosQuery.toAccountInfo({
        status: "not registered",
        delegated_pool: null,
        delegated_drep: null,
        rewards_available: 0n
      }).registered
    ).toBe(false)
  })
})

describe("extendedRowToUTxO", () => {
  const POLICY = "aa".repeat(28)
  const row = (assetName: string | null) => ({
    tx_hash: "ab".repeat(32),
    tx_index: 0n,
    address: "addr_test1vzpwq95z3xyum8vqndgdd9mdnmafh3djcxnc6jemlgdmswcve6tkw",
    value: 2_000_000n,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: [{ policy_id: POLICY, asset_name: assetName, fingerprint: "asset1x", decimals: null, quantity: 7n }]
  })

  it('reads a null asset_name as the EMPTY name, not as the string "null"', () => {
    // ⚠️ Koios sends `asset_name: null` for an empty asset name, which is common. Anything
    // that concatenates policy and name then emits `<policy>.null` — a four-byte garbage
    // asset name that matches nothing on chain. This shipped once.
    const utxo = _Koios.extendedRowToUTxO(row(null))
    expect(CoreAssets.getUnits(utxo.assets)).toEqual(["lovelace", POLICY])
    expect(CoreAssets.getByUnit(utxo.assets, POLICY)).toBe(7n)
  })

  it("carries a real asset name through", () => {
    const utxo = _Koios.extendedRowToUTxO(row("4e49474854"))
    expect(CoreAssets.getUnits(utxo.assets)).toEqual(["lovelace", `${POLICY}4e49474854`])
  })
})

describe("chunkByBodyBytes", () => {
  // Koios refuses a body over 5120 bytes with a 413, so batches are sized by SERIALIZED length:
  // a fixed count silently works for short identifiers and fails for long ones.
  it("splits by serialized bytes, not by count", () => {
    const ids = Array.from({ length: 10 }, (_, i) => "x".repeat(20) + i)
    const chunks = _Koios.chunkByBodyBytes(ids, 60)
    expect(chunks.flat()).toEqual(ids)
    // Each id costs its length plus two quotes and a comma; the array's brackets cost two.
    for (const c of chunks) expect(2 + c.reduce((n, id) => n + id.length + 3, 0)).toBeLessThanOrEqual(60)
    expect(chunks.length).toBe(5) // 21-char ids cost 24 bytes each, so two fit in 60
  })

  it("gives an over-budget id its own chunk rather than dropping it", () => {
    const huge = "y".repeat(500)
    expect(_Koios.chunkByBodyBytes(["a", huge, "b"], 20)).toEqual([["a"], [huge], ["b"]])
  })

  it("asks nothing when there is nothing to ask about", () => {
    expect(_Koios.chunkByBodyBytes([])).toEqual([])
  })
})

describe("pageAll", () => {
  const page = (total: number) => (offset: number) =>
    Effect.succeed(
      Array.from({ length: Math.max(0, Math.min(_Koios.PAGE_SIZE, total - offset)) }, (_, i) => offset + i)
    )

  it("stops at the first short page", async () => {
    const rows = await Effect.runPromise(_Koios.pageAll("/t", page(10)))
    expect(rows).toEqual(Array.from({ length: 10 }, (_, i) => i))
  })

  // A truncated listing reads exactly like a smaller answer, so a full page is never the end.
  it("keeps going past an exactly-full page", async () => {
    const rows = await Effect.runPromise(_Koios.pageAll("/t", page(_Koios.PAGE_SIZE)))
    expect(rows.length).toBe(_Koios.PAGE_SIZE)
    const more = await Effect.runPromise(_Koios.pageAll("/t", page(_Koios.PAGE_SIZE + 3)))
    expect(more.length).toBe(_Koios.PAGE_SIZE + 3)
  })

  it("propagates a later page's failure instead of returning the rows it had", async () => {
    const full = Array.from({ length: _Koios.PAGE_SIZE }, (_, i) => i)
    const result = await Effect.runPromise(
      Effect.either(_Koios.pageAll("/t", (offset) => (offset === 0 ? Effect.succeed(full) : Effect.fail("boom"))))
    )
    // Taken from the TYPED channel: `Effect.runPromise` reports every failure as "An error has
    // occurred", so a thrown-message comparison would only ever check "it threw".
    expect(Either.isLeft(result) && result.left).toBe("boom")
  })
})
