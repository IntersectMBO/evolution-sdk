import * as E from "@evolution-sdk/evolution"
import { Assets } from "@evolution-sdk/evolution"
import { describe, expect, it } from "vitest"

import * as Plan from "../src/Plan.js"

/**
 * Real Conway-shaped parameters: the entry points measure serialized bytes, so a
 * fabricated fee rate would not exercise the thing under test.
 */
const PARAMS: Plan.ProtocolParams = {
  minFeeA: 44n,
  minFeeB: 155_381n,
  coinsPerUtxoByte: 4310n,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  maxValueSize: 5000n,
  maxTxSize: 16_384n
}

const ADDR = `00${"11".repeat(28)}${"22".repeat(28)}`
const CHANGE = `00${"33".repeat(28)}${"44".repeat(28)}`
const txHash = (byte: string) => byte.repeat(32)

const utxo = (byte: string, index: number, lovelace: bigint): Plan.PlanInput => ({
  txHash: txHash(byte),
  index,
  assets: Assets.fromLovelace(lovelace)
})

describe("buildUnsigned — the codec-free build", () => {
  it("balances a send and emits change", () => {
    const built = Plan.buildUnsigned({
      inputs: [utxo("aa", 0, 10_000_000n)],
      outputs: [{ addressHex: ADDR, assets: Assets.fromLovelace(3_000_000n) }],
      changeAddressHex: CHANGE,
      params: PARAMS,
      signerCount: 1
    })
    expect(built.bodyHex.length).toBeGreaterThan(0)
    expect(built.inputs).toHaveLength(1)
    expect(built.changeOutputs).toHaveLength(1)
    // consumed = produced: inputs cover outputs + fee + change.
    expect(built.fee).toBeGreaterThan(0n)
  })
})

describe("fitBySize — the codec-free size search", () => {
  const planFor = (take: number): Plan.UnsignedCardanoPlan => ({
    inputs: Array.from({ length: 40 }, (_, i) => utxo("bb", i, 5_000_000n)),
    outputs: Array.from({ length: take }, () => ({ addressHex: ADDR, assets: Assets.fromLovelace(1_500_000n) })),
    changeAddressHex: CHANGE,
    params: PARAMS,
    signerCount: 1
  })

  it("takes every item when they all fit", () => {
    const r = Plan.fitBySize(planFor, 3)
    expect(r.taken).toBe(3)
    expect(r.dropped).toBe(0)
    expect(r.built.bodyHex.length).toBeGreaterThan(0)
  })

  it("is byte-identical to the codec-taking variant it wraps", () => {
    // A wrapper reaching a *different* codec would still produce a plausible
    // body, so only the bytes can tell the two apart.
    const free = Plan.fitBySize(planFor, 3)
    const explicit = Plan.fitBySizeSync(planFor, 3)
    expect(free.built.bodyHex).toBe(explicit.built.bodyHex)
    expect(free.taken).toBe(explicit.taken)
  })

  it("drops what does not fit under a small maxTxSize", () => {
    const tight = (take: number): Plan.UnsignedCardanoPlan => ({
      ...planFor(take),
      params: { ...PARAMS, maxTxSize: 400n }
    })
    const r = Plan.fitBySize(tight, 12)
    expect(r.taken).toBeLessThan(12)
    expect(r.dropped).toBe(12 - r.taken)
  })

  it("never returns fewer than minTake, and raises the real size error when that floor does not fit", () => {
    const tight = (take: number): Plan.UnsignedCardanoPlan => ({
      ...planFor(take),
      params: { ...PARAMS, maxTxSize: 400n }
    })
    // At the default floor this same plan packs a small prefix successfully, so
    // the throw below is the floor being honoured rather than the plan being
    // unbuildable.
    expect(Plan.fitBySize(tight, 12).taken).toBeGreaterThanOrEqual(1)
    expect(() => Plan.fitBySize(tight, 12, undefined, 10)).toThrow(Plan.TxTooLargeError)
  })

  it("rejects a minTake above itemCount rather than silently clamping it", () => {
    expect(() => Plan.fitBySize(planFor, 2, undefined, 5)).toThrow(/minTake 5 exceeds itemCount 2/)
  })

  it("rejects a non-positive itemCount rather than packing nothing", () => {
    expect(() => Plan.fitBySize(planFor, 0)).toThrow(/itemCount must be positive/)
  })
})

describe("packAssetsByValueSize — the codec-free asset packing", () => {
  const assets = (n: number, policyByte: string): Array<Plan.AssetAmount> =>
    Array.from({ length: n }, (_, i) => ({
      assetId: `${policyByte.repeat(28)}.${i.toString(16).padStart(4, "0")}`,
      amount: 1n
    }))

  it("keeps one group when the value fits the bound", () => {
    const { groups } = Plan.packAssetsByValueSize(assets(2, "7a"), 5000n, 2_000_000n)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it("splits into more groups as the bound tightens, preserving order and count", () => {
    const list = assets(30, "7a")
    const { groups } = Plan.packAssetsByValueSize(list, 80n, 2_000_000n)
    expect(groups.length).toBeGreaterThan(1)
    expect(groups.flatMap((g) => g.map((a) => a.assetId))).toEqual(list.map((a) => a.assetId))
  })

  it("returns no groups for no assets, rather than one empty group", () => {
    expect(Plan.packAssetsByValueSize([], 5000n, 2_000_000n).groups).toEqual([])
  })

  it("is identical to the codec-taking variant it wraps", () => {
    const list = assets(30, "7a")
    expect(Plan.packAssetsByValueSize(list, 80n, 2_000_000n)).toEqual(
      Plan.packAssetsByValueSizeSync(list, 80n, 2_000_000n)
    )
  })

  it("fails when a single asset cannot fit on its own", () => {
    expect(() => Plan.packAssetsByValueSize(assets(1, "7a"), 1n, 2_000_000n)).toThrow(Plan.ValueTooLargeError)
  })
})

describe("auto-collateral — the body keys only this engine emits", () => {
  /**
   * An always-true Plutus V3 validator: the smallest script that makes the plan
   * carry a redeemer, which is what turns auto-collateral on.
   */
  const SCRIPT_V3 = "46450101002499"

  /**
   * `collateralPercentage` is what enables auto-collateral, and the V3 cost model
   * is what the script_data_hash needs. A flat model is fine: the hash must be
   * *some* committed value, and the fee components are asserted by Fees.test.
   */
  const PLUTUS_PARAMS: Plan.ProtocolParams = {
    ...PARAMS,
    priceMem: [577n, 10_000n],
    priceStep: [721n, 10_000_000n],
    collateralPercentage: 150,
    maxCollateralInputs: 3,
    plutusV3CostModel: Array.from({ length: 251 }, () => 0n)
  }

  const plutusPlan = (lovelace: bigint): Plan.UnsignedCardanoPlan => ({
    inputs: [utxo("cc", 0, lovelace)],
    outputs: [{ addressHex: ADDR, assets: Assets.fromLovelace(2_000_000n) }],
    changeAddressHex: CHANGE,
    params: PLUTUS_PARAMS,
    plutus: {
      scriptsV3: [SCRIPT_V3],
      redeemers: [{ tag: 0, index: 0n, dataHex: "d87980", mem: 1000n, steps: 500_000n }],
      costModels: [{ language: 2, costs: Array.from({ length: 251 }, () => 0n) }]
    },
    signerCount: 1
  })

  it("assembles a Plutus body whose collateral takes a return output (body keys 16 and 17)", () => {
    // A large input makes the collateral return clear min-ADA, which is the only
    // branch that emits keys 16/17 — the branch no script-free plan can reach.
    const built = Plan.buildUnsigned(plutusPlan(60_000_000n))
    // Decoding the body back is what proves the two fields round-tripped; that
    // assembly merely did not throw would also hold if they had been dropped.
    const body = E.TransactionBody.fromCBORHex(built.bodyHex)
    expect(body.totalCollateral).toBeGreaterThan(0n)
    expect(body.collateralReturn).toBeDefined()
    expect(body.collateralInputs?.length).toBeGreaterThan(0)
    // 150% of the fee, which is what collateralPercentage asks for.
    expect(body.totalCollateral).toBe((built.fee * 150n + 99n) / 100n)
  })

  it("rejects an unmodelled body key by name rather than dropping it", () => {
    // A dropped body key changes script_data_hash and yields a transaction the
    // ledger rejects for reasons pointing nowhere near the missing field.
    expect(() =>
      Plan.buildUnsigned({
        ...plutusPlan(60_000_000n),
        bodyExtra: [[99, "00"]]
      })
    ).toThrow(/key 99 is not modelled/)
  })
})
