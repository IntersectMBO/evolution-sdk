import { describe, expect, it } from "vitest"

import * as AssetName from "../src/AssetName.js"
import * as Mint from "../src/Mint.js"
import * as MultiAsset from "../src/MultiAsset.js"
import * as PolicyId from "../src/PolicyId.js"
import * as Value from "../src/Value.js"

/**
 * CIP-21 (Category: Wallets, Status: Active) requires canonical CBOR map-key order in the
 * transaction body: shorter keys first, then lexicographic.
 *
 * It matters because a hardware wallet hashes the body in chunks and the client has to
 * reconstruct those exact bytes. An insertion-ordered multiasset is accepted by a node and
 * cannot be reliably signed by a device. For a mint it is also a transaction-id divergence,
 * because the mint field lives in the body.
 *
 * ⚠️ CML 6.2.0 is NOT an oracle for this: it writes multiasset keys in insertion order, so it
 * reproduces whatever order it was given. cardano-serialization-lib 15.0.3 sorts, and the
 * expected hex below is what it produces for this value.
 */
describe("CIP-21 canonical map order", () => {
  // Inverted on BOTH dimensions the comparator orders by: a high policy before a low one, and
  // within a policy a long asset name before a short one.
  const POLICY_HI = "ff".repeat(28)
  const POLICY_LO = "00".repeat(28)
  const NAME_LONG = Buffer.from("zzzzzzzz", "utf8").toString("hex")
  const NAME_TINY = Buffer.from("a", "utf8").toString("hex")

  const unsorted = () => {
    let ma = MultiAsset.singleton(PolicyId.fromHex(POLICY_HI), AssetName.fromHex(NAME_LONG), 1n)
    ma = MultiAsset.addAsset(ma, PolicyId.fromHex(POLICY_LO), AssetName.fromHex(NAME_TINY), 2n)
    ma = MultiAsset.addAsset(ma, PolicyId.fromHex(POLICY_HI), AssetName.fromHex(NAME_TINY), 3n)
    ma = MultiAsset.addAsset(ma, PolicyId.fromHex(POLICY_LO), AssetName.fromHex(NAME_LONG), 4n)
    return ma
  }

  // cardano-serialization-lib 15.0.3, same value, same four assets added in the same order.
  const CSL_EXPECTED =
    "821a000f4240a2581c00000000000000000000000000000000000000000000000000000000" +
    "a2416102487a7a7a7a7a7a7a7a04581cffffffffffffffffffffffffffffffffffffffffffffffffffffffff" +
    "a2416103487a7a7a7a7a7a7a7a01"

  it("a value's policies and asset names are written in canonical order", () => {
    const hex = Value.toCBORHex(Value.withAssets(1000000n, unsorted()))
    // the low policy sorts before the high one, whatever order they were added in
    expect(hex.indexOf(POLICY_LO)).toBeLessThan(hex.indexOf(POLICY_HI))
    // and within a policy the one-byte name sorts before the eight-byte one
    const firstPolicy = hex.slice(hex.indexOf(POLICY_LO))
    expect(firstPolicy.indexOf(NAME_TINY)).toBeLessThan(firstPolicy.indexOf(NAME_LONG))
    expect(hex).toBe(CSL_EXPECTED)
  })

  it("a mint is written in the same order", () => {
    const mint = new Mint.Mint({ map: unsorted().map })
    const hex = Mint.toCBORHex(mint)
    expect(hex.indexOf(POLICY_LO)).toBeLessThan(hex.indexOf(POLICY_HI))
  })
})
