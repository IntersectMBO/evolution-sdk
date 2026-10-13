/**
 * Offline tests for the Blockfrost WALLET tier. `fetch` is stubbed per path, so each test states
 * exactly what the endpoint answered and the assertion is about the mapping.
 *
 * These cover the behaviours that are decisions rather than transcription: the per-address fan-out
 * and its deduplication, an absence reported as absent rather than zero, the collateral filter,
 * decimals read as exact rationals, and the two members this backend deliberately does not serve.
 */
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as Address from "../../src/Address.js"
import type * as RewardAddress from "../../src/RewardAddress.js"
import { BlockfrostProvider } from "../../src/sdk/provider/Blockfrost.js"
import * as BlockfrostQuery from "../../src/sdk/provider/internal/BlockfrostQuery.js"
import * as TransactionHash from "../../src/TransactionHash.js"

const BASE = "https://blockfrost.test/api/v0"
const PROJECT_ID = "testProjectId"

const stubRoutes = (routes: Record<string, string>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = routes[url.slice(BASE.length)]
      return Promise.resolve(
        body === undefined ? new Response('{"status_code":404}', { status: 404 }) : new Response(body, { status: 200 })
      )
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const ADDR_A = Address.fromBech32(
  "addr_test1qqkckqjjdk7davfwecamjwzsednvw4cwf62mr5q2q5h36mh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqnyn5fz"
)
const ADDR_B = Address.fromBech32(
  "addr_test1qpumulq4znkvwevs44w43znum0undsje2xrh3jgalt9kd6h927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqu6lfzr"
)
const BECH_A = Address.toBech32(ADDR_A)
const BECH_B = Address.toBech32(ADDR_B)
const STAKE = "stake_test1up4dh5etpe4g55cgsg4uhlfm0hrhzn35287ur57aksgqjwce84m7h" as RewardAddress.RewardAddress
const TX1 = "aff687a0934766b6d1798dfc29bc5a28600971e3a71279ba1be59e72820e5910"
const TX2 = "aca8c4a23a79cda061c46e61df993218d1708e0f7a5ff97b7b0485edadff8126"

describe("Blockfrost getTxsAt", () => {
  /**
   * ⚠️ `/addresses/{a}/transactions` takes ONE address, so this fans out. A transaction touching
   * two of the addresses asked about must come back ONCE — the member answers refs, not
   * per-address rows, and a duplicate would be counted twice by anything summing history.
   */
  it("fans out per address and deduplicates a transaction touching two of them", async () => {
    stubRoutes({
      [`/addresses/${BECH_A}/transactions?count=100&page=1`]: JSON.stringify([
        { tx_hash: TX1, block_height: 100, block_time: 1000 },
        { tx_hash: TX2, block_height: 90, block_time: 900 }
      ]),
      [`/addresses/${BECH_B}/transactions?count=100&page=1`]: JSON.stringify([
        { tx_hash: TX1, block_height: 100, block_time: 1000 }
      ])
    })

    const refs = await Effect.runPromise(BlockfrostQuery.getTxsAt(BASE, PROJECT_ID)([ADDR_A, ADDR_B]))

    expect(refs.map((r) => TransactionHash.toHex(r.txHash))).toEqual([TX1, TX2])
    expect(refs[0].blockHeight).toBe(100)
  })

  it("orders newest first across addresses", async () => {
    stubRoutes({
      [`/addresses/${BECH_A}/transactions?count=100&page=1`]: JSON.stringify([
        { tx_hash: TX2, block_height: 90, block_time: 900 }
      ]),
      [`/addresses/${BECH_B}/transactions?count=100&page=1`]: JSON.stringify([
        { tx_hash: TX1, block_height: 100, block_time: 1000 }
      ])
    })

    const refs = await Effect.runPromise(BlockfrostQuery.getTxsAt(BASE, PROJECT_ID)([ADDR_A, ADDR_B]))
    expect(refs.map((r) => r.blockHeight)).toEqual([100, 90])
  })

  it("applies afterBlock as a filter, not as a page bound", async () => {
    stubRoutes({
      [`/addresses/${BECH_A}/transactions?count=100&page=1`]: JSON.stringify([
        { tx_hash: TX1, block_height: 100, block_time: 1000 },
        { tx_hash: TX2, block_height: 90, block_time: 900 }
      ])
    })

    const refs = await Effect.runPromise(BlockfrostQuery.getTxsAt(BASE, PROJECT_ID)([ADDR_A], { afterBlock: 95 }))
    expect(refs.map((r) => TransactionHash.toHex(r.txHash))).toEqual([TX1])
  })

  /** A 404 is "the chain has never seen this address", a legitimate answer to a gap scan. */
  it("reads a 404 as no history rather than as a failure", async () => {
    stubRoutes({})
    const refs = await Effect.runPromise(BlockfrostQuery.getTxsAt(BASE, PROJECT_ID)([ADDR_A]))
    expect(refs).toEqual([])
  })
})

describe("Blockfrost getAddressesSeen", () => {
  it("returns only the addresses the chain has seen", async () => {
    stubRoutes({ [`/addresses/${BECH_A}`]: JSON.stringify({ address: BECH_A }) })

    const seen = await Effect.runPromise(BlockfrostQuery.getAddressesSeen(BASE, PROJECT_ID)([ADDR_A, ADDR_B]))

    expect(seen.map(Address.toBech32)).toEqual([BECH_A])
  })
})

describe("Blockfrost getAccountInfo", () => {
  /**
   * ⚠️ The deposit is `undefined`, never `0`. Blockfrost does not report the registration deposit
   * on an account, and a zero deposit and an unknown one are different facts to anything
   * computing a refundable balance.
   */
  it("reports an unreported deposit as absent, not as zero", async () => {
    stubRoutes({
      [`/accounts/${STAKE}`]: JSON.stringify({
        active: true,
        controlled_amount: "9680459600",
        withdrawable_amount: "12345",
        pool_id: "pool1abc",
        drep_id: null
      })
    })

    const info = await Effect.runPromise(BlockfrostQuery.getAccountInfo(BASE, PROJECT_ID)(STAKE))

    expect(info?.deposit).toBeUndefined()
    expect(info?.deposit).not.toBe(0n)
    expect(info?.registered).toBe(true)
    expect(info?.delegatedPool).toBe("pool1abc")
    expect(info?.delegatedDRep).toBeNull()
    expect(info?.controlledBalance).toBe(9680459600n)
    expect(info?.rewardsAvailable).toBe(12345n)
  })

  it("answers null for an account the chain has never seen", async () => {
    stubRoutes({})
    expect(await Effect.runPromise(BlockfrostQuery.getAccountInfo(BASE, PROJECT_ID)(STAKE))).toBeNull()
  })
})

describe("Blockfrost getTxInfo", () => {
  const txRow = {
    hash: TX1,
    block: "blockhash",
    block_height: 100,
    block_time: 1000,
    slot: 5000,
    fees: "197885",
    valid_contract: true,
    withdrawal_count: 0,
    asset_mint_or_burn_count: 0,
    delegation_count: 0,
    stake_cert_count: 0,
    pool_update_count: 0,
    pool_retire_count: 0,
    mir_cert_count: 0
  }

  /**
   * ⚠️ Collateral and reference inputs are NOT spends. Counting them as inputs would overstate
   * what the transaction consumed, which is the number a balance delta is computed from.
   */
  it("excludes collateral and reference inputs, and collateral outputs", async () => {
    stubRoutes({
      [`/txs/${TX1}`]: JSON.stringify(txRow),
      [`/txs/${TX1}/utxos`]: JSON.stringify({
        hash: TX1,
        inputs: [
          { address: BECH_A, tx_hash: TX2, output_index: 0, amount: [{ unit: "lovelace", quantity: "5000000" }] },
          {
            address: BECH_B,
            tx_hash: TX2,
            output_index: 1,
            amount: [{ unit: "lovelace", quantity: "9" }],
            collateral: true
          },
          {
            address: BECH_B,
            tx_hash: TX2,
            output_index: 2,
            amount: [{ unit: "lovelace", quantity: "8" }],
            reference: true
          }
        ],
        outputs: [
          { address: BECH_B, output_index: 0, amount: [{ unit: "lovelace", quantity: "4000000" }] },
          {
            address: BECH_B,
            output_index: 1,
            amount: [{ unit: "lovelace", quantity: "7" }],
            collateral: true
          }
        ]
      })
    })

    const [tx] = await Effect.runPromise(
      BlockfrostQuery.getTxInfo(BASE, PROJECT_ID)([TransactionHash.fromHex(TX1)])
    )

    expect(tx.inputs).toHaveLength(1)
    expect(tx.outputs).toHaveLength(1)
    expect(tx.inputs[0].coin).toBe(5000000n)
    expect(tx.fee).toBe(197885n)
  })

  /** An input names the output it consumes; an output's position is its own index. */
  it("carries an outpoint on inputs and not on outputs", async () => {
    stubRoutes({
      [`/txs/${TX1}`]: JSON.stringify(txRow),
      [`/txs/${TX1}/utxos`]: JSON.stringify({
        hash: TX1,
        inputs: [{ address: BECH_A, tx_hash: TX2, output_index: 3, amount: [{ unit: "lovelace", quantity: "1" }] }],
        outputs: [{ address: BECH_B, output_index: 0, amount: [{ unit: "lovelace", quantity: "1" }] }]
      })
    })

    const [tx] = await Effect.runPromise(
      BlockfrostQuery.getTxInfo(BASE, PROJECT_ID)([TransactionHash.fromHex(TX1)])
    )

    expect(tx.inputs[0].outpoint).toBeDefined()
    expect(TransactionHash.toHex(tx.inputs[0].outpoint!.txHash)).toBe(TX2)
    expect(tx.inputs[0].outpoint!.index).toBe(3)
    expect(tx.outputs[0].outpoint).toBeUndefined()
  })

  /**
   * ⚠️ Certificates are COUNTS on `/txs/{h}`, served per kind from their own endpoints. A
   * transaction whose `stake_cert_count` is 2 must not come back with no certificates — but one
   * with all counts zero must cost no extra request.
   */
  it("fetches only the certificate kinds the counts say are present", async () => {
    stubRoutes({
      [`/txs/${TX1}`]: JSON.stringify({ ...txRow, stake_cert_count: 2 }),
      [`/txs/${TX1}/utxos`]: JSON.stringify({ hash: TX1, inputs: [], outputs: [] }),
      [`/txs/${TX1}/stakes`]: JSON.stringify([{ cert_index: 0 }, { cert_index: 1 }])
    })

    const [tx] = await Effect.runPromise(
      BlockfrostQuery.getTxInfo(BASE, PROJECT_ID)([TransactionHash.fromHex(TX1)])
    )

    expect(tx.certificates.map((c) => c.type)).toEqual(["stake", "stake"])
    // The kinds whose count is zero were never requested.
    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<Array<string>> } }).mock.calls.map((c) => c[0])
    expect(calls.some((u) => u.includes("/delegations"))).toBe(false)
    expect(calls.some((u) => u.includes("/pool_updates"))).toBe(false)
  })

  /**
   * ⚠️ A phase-2 failure is ON CHAIN: collateral consumed, outputs never produced. Reporting it
   * as an ordinary send is a wrong row in the user's history, so the verdict is carried where
   * the backend gives one. Koios does not, and leaves the field absent — which the field
   * documents as "unknown", never "valid".
   */
  it("carries the phase-2 verdict, both ways", async () => {
    const utxos = JSON.stringify({ hash: TX1, inputs: [], outputs: [] })
    stubRoutes({
      [`/txs/${TX1}`]: JSON.stringify({ ...txRow, valid_contract: false }),
      [`/txs/${TX1}/utxos`]: utxos
    })
    const [failed] = await Effect.runPromise(
      BlockfrostQuery.getTxInfo(BASE, PROJECT_ID)([TransactionHash.fromHex(TX1)])
    )
    expect(failed.valid).toBe(false)

    stubRoutes({ [`/txs/${TX1}`]: JSON.stringify(txRow), [`/txs/${TX1}/utxos`]: utxos })
    const [ok] = await Effect.runPromise(
      BlockfrostQuery.getTxInfo(BASE, PROJECT_ID)([TransactionHash.fromHex(TX1)])
    )
    expect(ok.valid).toBe(true)
  })

  it("skips a transaction the backend does not have rather than failing the batch", async () => {
    stubRoutes({})
    const out = await Effect.runPromise(
      BlockfrostQuery.getTxInfo(BASE, PROJECT_ID)([TransactionHash.fromHex(TX1)])
    )
    expect(out).toEqual([])
  })
})

describe("Blockfrost getChainParameters", () => {
  const PARAMS = {
    pvt_motion_no_confidence: 0.51,
    pvt_committee_normal: 0.52,
    pvt_committee_no_confidence: 0.53,
    pvt_hard_fork_initiation: 0.54,
    pvt_p_p_security_group: 0.55,
    dvt_motion_no_confidence: 0.61,
    dvt_committee_normal: 0.62,
    dvt_committee_no_confidence: 0.63,
    dvt_update_to_constitution: 0.64,
    dvt_hard_fork_initiation: 0.65,
    dvt_p_p_network_group: 0.66,
    dvt_p_p_economic_group: 0.67,
    dvt_p_p_technical_group: 0.68,
    dvt_p_p_gov_group: 0.69,
    dvt_treasury_withdrawal: 0.7,
    committee_min_size: 7,
    committee_max_term_length: 146,
    gov_action_lifetime: 6,
    gov_action_deposit: "100000000000",
    drep_activity: 20,
    max_block_size: 90112,
    max_block_header_size: 1100,
    e_max: 18,
    n_opt: 500,
    a0: 0.3,
    rho: 0.003,
    tau: 0.2,
    min_pool_cost: "170000000",
    max_tx_ex_mem: "14000000",
    max_tx_ex_steps: "10000000000",
    max_block_ex_mem: "62000000",
    max_block_ex_steps: "20000000000",
    protocol_major_ver: 10,
    protocol_minor_ver: 0,
    price_mem: 0.0577,
    price_step: 0.0000721,
    min_fee_ref_script_cost_per_byte: 15,
    cost_models_raw: { PlutusV1: [100, 200], PlutusV2: [300], PlutusV3: [400] }
  }

  /**
   * ⚠️ `0.51` has no exact binary double, and these are thresholds a vote is decided against. They
   * must come back as exact rationals, which is the form the chain itself uses — `51/100`, not
   * whatever the nearest double expands to.
   */
  it("reads decimals as EXACT rationals, not as doubles", async () => {
    stubRoutes({ "/epochs/latest/parameters": JSON.stringify(PARAMS) })

    const c = await Effect.runPromise(BlockfrostQuery.getChainParameters(BASE, PROJECT_ID)())

    expect(c.poolVotingThresholds[0].numerator).toBe(51n)
    expect(c.poolVotingThresholds[0].denominator).toBe(100n)
    expect(c.treasuryCut.numerator).toBe(1n)
    expect(c.treasuryCut.denominator).toBe(5n)
    // 0.0000721 in exponent form is where a toFixed round trip loses the value entirely.
    expect(c.executionPrices.step.numerator).toBe(721n)
    expect(c.executionPrices.step.denominator).toBe(10_000_000n)
  })

  it("keeps the CDDL order of both threshold lists, which IS the schema", async () => {
    stubRoutes({ "/epochs/latest/parameters": JSON.stringify(PARAMS) })

    const c = await Effect.runPromise(BlockfrostQuery.getChainParameters(BASE, PROJECT_ID)())

    expect(c.poolVotingThresholds).toHaveLength(5)
    expect(c.drepVotingThresholds).toHaveLength(10)
    // ⚠️ Compared as VALUES, not as raw numerators: the rationals are reduced, so 0.65 is 13/20
    // and 0.7 is 7/10. Asserting the numerator would be asserting the reduction, not the order.
    const value = (t: { numerator: bigint; denominator: bigint }) => Number(t.numerator) / Number(t.denominator)
    expect(c.poolVotingThresholds.map(value)).toEqual([0.51, 0.52, 0.53, 0.54, 0.55])
    expect(c.drepVotingThresholds.map(value)).toEqual([0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7])
  })

  it("carries the cost models as ordered bigint arrays", async () => {
    stubRoutes({ "/epochs/latest/parameters": JSON.stringify(PARAMS) })
    const c = await Effect.runPromise(BlockfrostQuery.getChainParameters(BASE, PROJECT_ID)())
    expect(c.plutusV1CostModel).toEqual([100n, 200n])
    expect(c.plutusV3CostModel).toEqual([400n])
  })
})

describe("Blockfrost governance", () => {
  it("reads a DRep listing's active flag from retired AND expired", async () => {
    stubRoutes({
      "/governance/dreps?count=100&page=1": JSON.stringify([
        { drep_id: "drep1live", amount: "10", retired: false, expired: false },
        { drep_id: "drep1retired", amount: "20", retired: true, expired: false },
        { drep_id: "drep1expired", amount: "30", retired: false, expired: true }
      ])
    })

    const dreps = await Effect.runPromise(BlockfrostQuery.getDReps(BASE, PROJECT_ID)())

    expect(dreps.map((d) => d.active)).toEqual([true, false, false])
    expect(dreps[0].amount).toBe(10n)
  })

  /** `/pools/extended` carries no status column; a retirement only shows on `/pools/{id}`. */
  it("reports a pool as retiring only when the per-pool endpoint says so", async () => {
    stubRoutes({
      "/pools/pool1x": JSON.stringify({
        pool_id: "pool1x",
        active_stake: "1",
        live_stake: "2",
        retirement: [{ epoch: 500 }]
      })
    })
    const p = await Effect.runPromise(BlockfrostQuery.getPool(BASE, PROJECT_ID)("pool1x"))
    expect(p?.status).toBe("retiring")
  })

  it("refuses a proposal id that is not <txHash>#<certIndex> rather than guessing", async () => {
    stubRoutes({})
    const exit = await Effect.runPromiseExit(BlockfrostQuery.getProposal(BASE, PROJECT_ID)("not-an-id"))
    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("is not a <txHash>#<certIndex>")
  })

  it("splits a proposal id into the transaction and certificate index the endpoint is keyed on", async () => {
    stubRoutes({
      [`/governance/proposals/${TX1}/2`]: JSON.stringify({
        ratified_epoch: 10,
        enacted_epoch: null,
        expired_epoch: null,
        expiration: 42
      })
    })

    const p = await Effect.runPromise(BlockfrostQuery.getProposal(BASE, PROJECT_ID)(`${TX1}#2`))

    expect(p?.proposalId).toBe(`${TX1}#2`)
    expect(p?.ratifiedEpoch).toBe(10)
    expect(p?.expiration).toBe(42)
    // Absent, not null: an un-enacted proposal has no enactment epoch to report.
    expect(p?.enactedEpoch).toBeUndefined()
  })

  it("names the proposal on a proposal-scoped vote, which the rows do not carry", async () => {
    stubRoutes({
      [`/governance/proposals/${TX1}/0/votes?count=100&page=1`]: JSON.stringify([
        { tx_hash: TX2, vote: "yes" }
      ])
    })

    const votes = await Effect.runPromise(BlockfrostQuery.getVotesByProposal(BASE, PROJECT_ID)(`${TX1}#0`))

    expect(votes[0].proposalId).toBe(`${TX1}#0`)
    expect(votes[0].voteTxHash).toBe(TX2)
  })
})

describe("the Blockfrost provider's served surface", () => {
  /**
   * ⚠️ These two are ABSENT, not throwing stubs. Blockfrost has no credential-keyed UTxO query —
   * an endpoint that does not exist, not a missing parameter. A capability probe reads
   * `provider[member] !== undefined` to decide whether a wallet may advertise a query layer to a
   * dApp, so a member that exists and fails would make the claim true up front and false mid-flow.
   */
  it("does not serve the credential-keyed queries Blockfrost has no endpoint for", () => {
    const p = new BlockfrostProvider(BASE, PROJECT_ID).effect
    expect(p.getUtxosByPaymentCredential).toBeUndefined()
    expect(p.getUtxosByPaymentCredentials).toBeUndefined()
  })

  it("serves the wallet tier it does have", () => {
    const p = new BlockfrostProvider(BASE, PROJECT_ID).effect
    for (
      const m of [
        "getTxsAt",
        "getTxInfo",
        "getTxCbor",
        "getAccountInfo",
        "getAccountAddresses",
        "getAccountUtxos",
        "getAccountTxs",
        "getAddressesSeen",
        "getUtxosByAsset",
        "getUtxosOfTransaction",
        "getScriptByHash",
        "getProtocolParametersAt",
        "getChainParameters",
        "getDReps",
        "getDRep",
        "getCommittee",
        "getPools",
        "getPool",
        "getProposals",
        "getProposal",
        "getVotesByDRep",
        "getVotesByPool",
        "getVotesByCommittee",
        "getVotesByProposal"
      ] as const
    ) {
      expect(p[m], `${m} should be served`).toBeDefined()
    }
  })
})
