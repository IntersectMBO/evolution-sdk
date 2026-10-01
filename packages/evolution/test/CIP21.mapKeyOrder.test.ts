import { describe, expect, it } from "vitest"

import * as AssetName from "../src/AssetName.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Mint from "../src/Mint.js"
import * as MultiAsset from "../src/MultiAsset.js"
import * as PolicyId from "../src/PolicyId.js"
import * as RewardAccount from "../src/RewardAccount.js"
import * as Transaction from "../src/Transaction.js"
import * as Withdrawals from "../src/Withdrawals.js"

// CIP-21 requires map keys in canonical CBOR order (shorter first, then bytewise).
// Hardware wallets serialize the body themselves in that order, so any other order
// yields a body hash that does not match the transaction.

// Policies in the insertion order a builder produced for a real preprod deployment.
const POLICY_56 = "56ed5fe5fdd4814a765f8764202e36b2edbbae3d9445bc4e0f47b130"
const POLICY_8C = "8cba3e2854202e9f76c70483427622593d918e7bbcfffd7fee9f2333"
const POLICY_73 = "7379415fc9f3b9dd076e5b3cf17ca12e67cf9e4a3763192b949e9275"
const CANONICAL_POLICIES = [POLICY_56, POLICY_73, POLICY_8C]

// "0000" sorts after "ff": length decides before byte value.
const ASSET_NAMES = ["ff", "0000", "01"]
const CANONICAL_ASSET_NAMES = ["01", "ff", "0000"]
const ASSETS: Array<[AssetName.AssetName, bigint]> = ASSET_NAMES.map((name, i) => [
  AssetName.fromHex(name),
  BigInt(i + 1)
])

const mapKeysHex = (cbor: CBOR.CBOR): Array<string> => {
  if (!(cbor instanceof Map)) throw new Error("expected a CBOR map")
  return [...cbor.keys()].map((key) => {
    if (!(key instanceof Uint8Array)) throw new Error("expected byte-string keys")
    return Bytes.toHex(key)
  })
}

describe("CIP-21 canonical map key order on encode", () => {
  it("Mint emits policy IDs and asset names in canonical order", () => {
    const mint = Mint.fromEntries([POLICY_56, POLICY_8C, POLICY_73].map((p) => [PolicyId.fromHex(p), ASSETS]))

    const encoded = CBOR.fromCBORHex(Mint.toCBORHex(mint))

    expect(mapKeysHex(encoded)).toEqual(CANONICAL_POLICIES)
    if (!(encoded instanceof Map)) throw new Error("expected a CBOR map")
    for (const assets of encoded.values()) expect(mapKeysHex(assets)).toEqual(CANONICAL_ASSET_NAMES)
  })

  it("MultiAsset emits policy IDs and asset names in canonical order", () => {
    const multiAsset = new MultiAsset.MultiAsset({
      map: new Map([POLICY_56, POLICY_8C, POLICY_73].map((p) => [PolicyId.fromHex(p), new Map(ASSETS)]))
    })

    const encoded = CBOR.fromCBORHex(MultiAsset.toCBORHex(multiAsset))

    expect(mapKeysHex(encoded)).toEqual(CANONICAL_POLICIES)
    if (!(encoded instanceof Map)) throw new Error("expected a CBOR map")
    for (const assets of encoded.values()) expect(mapKeysHex(assets)).toEqual(CANONICAL_ASSET_NAMES)
  })

  it("Withdrawals emits reward accounts in canonical order", () => {
    const accounts = ["f0" + "00".repeat(28), "e0" + "bb".repeat(28), "e0" + "aa".repeat(28)]
    const withdrawals = Withdrawals.fromEntries(accounts.map((a) => [RewardAccount.fromHex(a), 0n]))

    const encoded = CBOR.fromCBORHex(Withdrawals.toCBORHex(withdrawals))

    expect(mapKeysHex(encoded)).toEqual([accounts[2], accounts[1], accounts[0]])
  })

  it("decoded transactions keep their original mint order, so their hash and signatures stay valid", () => {
    // Body mint map lists 8cba… before 7379… (non-canonical).
    const nonCanonicalTxHex =
      "84a400d90102818258201111111111111111111111111111111111111111111111111111111111111111000180020009a2581c" +
      POLICY_8C +
      "a14001581c" +
      POLICY_73 +
      "a14001a0f5f6"

    expect(Transaction.toCBORHex(Transaction.fromCBORHex(nonCanonicalTxHex))).toBe(nonCanonicalTxHex)
  })
})
