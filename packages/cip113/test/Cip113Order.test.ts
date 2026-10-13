/**
 * The orderings and selections a CIP-113 transfer depends on, none of which were tested.
 *
 * Every rule here decides an INDEX that travels in a redeemer, and an index is the one kind of
 * mistake no decoder can catch: it is a small integer either way, so a wrong one builds, signs,
 * submits, and fails in phase 2 with the fee spent. The two that matter most disagree with the
 * order a reader would assume:
 *
 *  - the script context's withdrawal order is NOT the order the withdrawals map is serialised in
 *    (script credentials sort before key ones, which inverts the reward-account byte order);
 *  - Plutus compares bytestrings with the SHORTER one smaller on a prefix tie, which is what
 *    makes a 30-byte sentinel greater than any 28-byte policy id.
 */
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import { Network } from "../src/Types.js"

const h = (b: string, n = 28): string => b.repeat(n)

const nodeOf = (keyHex: string, nextHex: string, transferLogicHex: string): Cip113.RegistryNode => ({
  keyHex,
  nextHex,
  mintingLogicScript: Cip113.ABSENT_CRED,
  transferLogicScript: { kind: "script", hashHex: transferLogicHex },
  thirdPartyTransferLogicScript: Cip113.ABSENT_CRED,
  unfrackingLogicScript: Cip113.ABSENT_CRED,
  globalStateCsHex: "",
})

describe("Plutus bytestring comparison", () => {
  it("compares byte by byte", () => {
    expect(Cip113.compareHexBytes("00", "01")).toBeLessThan(0)
    expect(Cip113.compareHexBytes("ff", "fe")).toBeGreaterThan(0)
    expect(Cip113.compareHexBytes("0a0b", "0a0b")).toBe(0)
    expect(Cip113.compareHexBytes("0a0c", "0a0b")).toBeGreaterThan(0)
  })

  it("treats bytes as UNSIGNED — the comparison that a signed byte would invert", () => {
    // `80` and above have the high bit set. Read as signed they would sort before `00`, and a
    // registry walk would then skip half the policy space.
    expect(Cip113.compareHexBytes("80", "7f")).toBeGreaterThan(0)
    expect(Cip113.compareHexBytes("ff", "00")).toBeGreaterThan(0)
  })

  it("makes the shorter string smaller on a prefix tie", () => {
    expect(Cip113.compareHexBytes("", "00")).toBeLessThan(0)
    expect(Cip113.compareHexBytes("0a", "0a0b")).toBeLessThan(0)
    expect(Cip113.compareHexBytes("0a0b", "0a")).toBeGreaterThan(0)
  })

  it("orders the origin key below, and the sentinel above, every policy id", () => {
    // The sentinel's 30 bytes are what put it above an all-`ff` 28-byte policy: on the prefix tie
    // the longer string wins. Normalised to 28 bytes it would merely EQUAL that policy, and the
    // last node would stop covering the top of the range.
    const top = h("ff")
    expect(Cip113.compareHexBytes(Cip113.ORIGIN_NODE_KEY, h("00"))).toBeLessThan(0)
    expect(Cip113.compareHexBytes(top, Cip113.SENTINEL_NEXT_KEY)).toBeLessThan(0)
    expect(Cip113.SENTINEL_NEXT_KEY.length / 2).toBe(30)
  })
})

describe("the ledger's withdrawal order", () => {
  const SCRIPT_A = h("11")
  const SCRIPT_B = h("22")
  const KEY_C = h("05")

  const keyOf = (kind: "key" | "script", hashHex: string): Cip113.WithdrawalKey => ({
    rewardAcctHex: kind === "script"
      ? Cip113.delegateRewardAccountHex(Network.Testnet, hashHex)
      : `e0${hashHex}`,
    cred: { kind, hashHex },
  })

  const scriptA = keyOf("script", SCRIPT_A)
  const scriptB = keyOf("script", SCRIPT_B)
  const keyC = keyOf("key", KEY_C)

  it("sorts bytewise among withdrawals of the same kind", () => {
    expect(Cip113.compareWithdrawalKeys(scriptA, scriptB)).toBeLessThan(0)
    expect(Cip113.compareWithdrawalKeys(scriptB, scriptA)).toBeGreaterThan(0)
    expect(Cip113.compareWithdrawalKeys(scriptA, scriptA)).toBe(0)
    expect(Cip113.withdrawalIndexOf([scriptB, scriptA], scriptA.rewardAcctHex)).toBe(0)
    expect(Cip113.withdrawalIndexOf([scriptB, scriptA], scriptB.rewardAcctHex)).toBe(1)
  })

  it("⚠️ puts every script credential before every key one, inverting the serialised order", () => {
    // The whole reason this function exists. The tx body's withdrawals map is canonical CBOR,
    // sorted by the encoded reward account, and a key-stake account's header byte (0xe0) is lower
    // than a script-stake one's (0xf0) — so the map puts the KEY first. The script context is
    // built from the ledger's `Map RewardAccount Coin`, whose `Ord Credential` has
    // `ScriptHashObj` before `KeyHashObj`. The two orders disagree, and the redeemer's `wdrl_idx`
    // follows the ledger's.
    const set = [scriptA, keyC, scriptB]
    const byAccountBytes = [...set].sort((x, y) => (x.rewardAcctHex < y.rewardAcctHex ? -1 : 1))
    expect(byAccountBytes.map((w) => w.cred.hashHex)).toEqual([KEY_C, SCRIPT_A, SCRIPT_B])

    expect(Cip113.withdrawalIndexOf(set, scriptA.rewardAcctHex)).toBe(0)
    expect(Cip113.withdrawalIndexOf(set, scriptB.rewardAcctHex)).toBe(1)
    expect(Cip113.withdrawalIndexOf(set, keyC.rewardAcctHex)).toBe(2)
    // And the disagreement is real, not a tie this test happens to break the same way.
    expect(Cip113.withdrawalIndexOf(set, keyC.rewardAcctHex)).not.toBe(
      byAccountBytes.findIndex((w) => w.rewardAcctHex === keyC.rewardAcctHex)
    )
  })

  it("coincides with the serialised order while every withdrawal is a script", () => {
    // Which is true of every transfer this package builds — and is exactly why getting the rule
    // wrong would stay invisible until the first signature-gated substandard hook joins one.
    const set = [scriptB, scriptA]
    const ledger = [...set].sort(Cip113.compareWithdrawalKeys).map((w) => w.rewardAcctHex)
    const serialised = [...set].sort((x, y) => (x.rewardAcctHex < y.rewardAcctHex ? -1 : 1)).map((w) => w.rewardAcctHex)
    expect(ledger).toEqual(serialised)
  })

  it("answers -1 for an account that is not in the set", () => {
    // ⚠️ Not 0. A caller that passed the framework's own withdrawals instead of the transaction's
    // complete set would otherwise get a plausible index for an account the context never holds.
    expect(Cip113.withdrawalIndexOf([scriptA, scriptB], keyC.rewardAcctHex)).toBe(-1)
    expect(Cip113.withdrawalIndexOf([], scriptA.rewardAcctHex)).toBe(-1)
  })

  it("does not reorder the caller's array", () => {
    const set = [scriptB, keyC, scriptA]
    Cip113.withdrawalIndexOf(set, scriptA.rewardAcctHex)
    expect(set.map((w) => w.cred.hashHex)).toEqual([SCRIPT_B, KEY_C, SCRIPT_A])
  })
})

describe("covering-node selection", () => {
  const P_LOW = h("20")
  const P_MID = h("50")
  const P_HIGH = h("90")
  const TL = h("d1")

  // origin → P_LOW → P_HIGH → sentinel
  const origin = nodeOf(Cip113.ORIGIN_NODE_KEY, P_LOW, TL)
  const low = nodeOf(P_LOW, P_HIGH, TL)
  const high = nodeOf(P_HIGH, Cip113.SENTINEL_NEXT_KEY, TL)
  const registry = [origin, low, high]

  it("proves membership with the policy's own node", () => {
    expect(Cip113.selectCoveringNode(registry, P_LOW)).toEqual({ kind: "exists", node: low })
    expect(Cip113.selectCoveringNode(registry, P_HIGH)).toEqual({ kind: "exists", node: high })
  })

  it("proves non-membership with the node whose range strictly contains the policy", () => {
    expect(Cip113.selectCoveringNode(registry, P_MID)).toEqual({ kind: "notExists", node: low })
  })

  it("covers the bottom of the range with the origin node and the top with the last one", () => {
    expect(Cip113.selectCoveringNode(registry, h("01"))).toEqual({ kind: "notExists", node: origin })
    expect(Cip113.selectCoveringNode(registry, h("ff"))).toEqual({ kind: "notExists", node: high })
  })

  it("refuses to guess when the supplied view does not cover the policy", () => {
    // An incomplete registry read is the realistic failure (a paged indexer, a node added between
    // pages). Returning the nearest node would emit a proof the validator rejects in phase 2.
    expect(() => Cip113.selectCoveringNode([low], h("ff"))).toThrow(/no covering registry node/)
    expect(() => Cip113.selectCoveringNode([], P_LOW)).toThrow(/no covering registry node/)
  })

  it("refuses a policy id that is not hex rather than covering it by accident", () => {
    expect(() => Cip113.selectCoveringNode(registry, "not-a-policy")).toThrow(/no covering registry node/)
  })

  it("will not accept a node as its own cover", () => {
    // `key < policy < next` is strict at both ends: a node whose key equals the policy is an
    // `exists` proof, and the `notExists` branch must never pick it.
    const sel = Cip113.selectCoveringNode([low], P_LOW)
    expect(sel.kind).toBe("exists")
  })
})

describe("planning the registry proofs of a transfer", () => {
  const P_A = h("20")
  const P_B = h("40")
  const P_C = h("60")
  const TL = h("d1")

  const origin = nodeOf(Cip113.ORIGIN_NODE_KEY, P_A, TL)
  const a = nodeOf(P_A, P_C, TL)
  const c = nodeOf(P_C, Cip113.SENTINEL_NEXT_KEY, TL)
  const registry = [origin, a, c]

  it("emits one proof per moved policy, in the order the policies were given", () => {
    const plan = Cip113.planTransferProofs(registry, [P_C, P_A])
    expect(plan.proofs.map((p) => p.kind)).toEqual(["exists", "exists"])
    expect(plan.refNodes).toEqual([c, a])
    expect(plan.proofs.map((p) => p.nodeIdx)).toEqual([0, 1])
  })

  it("deduplicates the reference nodes two policies share, keeping both proofs", () => {
    // P_B is unregistered and covered by node A, which also proves P_A's membership. One
    // reference input, two proofs pointing at it — and the proofs keep different kinds.
    const plan = Cip113.planTransferProofs(registry, [P_A, P_B])
    expect(plan.refNodes).toEqual([a])
    expect(plan.proofs).toEqual([
      { kind: "exists", nodeIdx: 0 },
      { kind: "notExists", nodeIdx: 0 },
    ])
  })

  it("plans nothing for no moved policies", () => {
    expect(Cip113.planTransferProofs(registry, [])).toEqual({ refNodes: [], proofs: [] })
  })

  it("propagates the uncovered-policy failure instead of dropping the policy", () => {
    expect(() => Cip113.planTransferProofs([a], [h("ff")])).toThrow(/no covering registry node/)
  })
})
