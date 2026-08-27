import { describe, expect, it } from "vitest"

import * as AssetName from "../src/AssetName.js"
import * as MultiAsset from "../src/MultiAsset.js"
import * as PolicyId from "../src/PolicyId.js"
import * as Value from "../src/Value.js"

// PolicyId and AssetName are classes, so a plain Map compares them by reference.
// Each call here builds fresh key instances, which is what happens when one value
// is decoded from the chain and the other is constructed locally.
const policyId = () => PolicyId.fromHex("0".repeat(56))
const assetName = () => AssetName.fromHex("4d79546f6b656e")

describe("MultiAsset lookups with reference-distinct keys", () => {
  it("getAsset finds an asset held under an equal but distinct key", () => {
    const held = MultiAsset.singleton(policyId(), assetName(), 5n)
    expect(MultiAsset.getAsset(held, policyId(), assetName())).toBe(5n)
  })

  it("hasAsset reports an asset held under an equal but distinct key", () => {
    const held = MultiAsset.singleton(policyId(), assetName(), 5n)
    expect(MultiAsset.hasAsset(held, policyId(), assetName())).toBe(true)
  })

  it("getAssetsByPolicy lists assets under an equal but distinct policy id", () => {
    const held = MultiAsset.singleton(policyId(), assetName(), 5n)
    expect(MultiAsset.getAssetsByPolicy(held, policyId())).toHaveLength(1)
  })

  it("subtract cancels equal amounts held under distinct keys", () => {
    const held = MultiAsset.singleton(policyId(), assetName(), 5n)
    const same = MultiAsset.singleton(policyId(), assetName(), 5n)
    expect(() => MultiAsset.subtract(held, same)).toThrow()
  })

  it("subtract reduces the amount rather than leaving it untouched", () => {
    const held = MultiAsset.singleton(policyId(), assetName(), 5n)
    const two = MultiAsset.singleton(policyId(), assetName(), 2n)
    const rest = MultiAsset.subtract(held, two)
    expect(MultiAsset.getAsset(rest, policyId(), assetName())).toBe(3n)
  })
})

describe("Value.geq with reference-distinct keys", () => {
  const withAssets = (amount: bigint) => Value.withAssets(2_000_000n, MultiAsset.singleton(policyId(), assetName(), amount))

  it("reports insufficient assets as insufficient", () => {
    expect(Value.geq(withAssets(5n), withAssets(100n))).toBe(false)
  })

  it("reports sufficient assets as sufficient", () => {
    expect(Value.geq(withAssets(100n), withAssets(5n))).toBe(true)
  })

  it("reports an equal amount as sufficient", () => {
    expect(Value.geq(withAssets(5n), withAssets(5n))).toBe(true)
  })

  it("reports a missing asset as insufficient", () => {
    expect(Value.geq(Value.onlyCoin(2_000_000n), withAssets(1n))).toBe(false)
  })

  it("compares lovelace", () => {
    expect(Value.geq(Value.onlyCoin(1_000_000n), Value.onlyCoin(2_000_000n))).toBe(false)
    expect(Value.geq(Value.onlyCoin(2_000_000n), Value.onlyCoin(1_000_000n))).toBe(true)
  })
})
