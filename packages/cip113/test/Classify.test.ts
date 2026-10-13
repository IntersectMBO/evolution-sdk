/**
 * What a programmable token IS, per the registry — one case per row of the decision table.
 *
 * ⚠️ The rule this module exists to hold is that it never reassures. "Nobody can seize this" and
 * "we cannot tell whether anyone can seize this" are different answers, and collapsing the second
 * into the first is the one error that materially misleads a holder. Same for transferability:
 * most live policies delegate to an issuer script we cannot evaluate off-chain, so
 * `unknown-substandard` is a first-class answer rather than a failure.
 *
 * The deployment fixture is a SHIPPED record with the two classification inputs overridden, not a
 * hand-built one: everything else about it is then real.
 */
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import { classifyGeneration, classifyPolicy } from "../src/Classify.js"
import type { Cip113Deployment } from "../src/Deployment.js"
import { DEPLOYMENTS } from "../src/Deployment.js"

const h28 = (b: string): string => b.repeat(28)

const BASE = Object.values(DEPLOYMENTS).find((d): d is Cip113Deployment => d !== undefined)!

const deployment = (over: Partial<Cip113Deployment> = {}): Cip113Deployment => ({ ...BASE, ...over })

const ALWAYS_FAIL = h28("f0")
const POLICY = h28("50")
const TL = h28("b1")
const TP = h28("b2")
const UF = h28("b3")

const node = (over: Partial<Cip113.RegistryNode> = {}): Cip113.RegistryNode => ({
  keyHex: POLICY,
  nextHex: Cip113.SENTINEL_NEXT_KEY,
  mintingLogicScript: { kind: "script", hashHex: h28("b0") },
  transferLogicScript: { kind: "script", hashHex: TL },
  thirdPartyTransferLogicScript: { kind: "script", hashHex: TP },
  unfrackingLogicScript: { kind: "script", hashHex: UF },
  globalStateCsHex: "",
  ...over,
})

/** origin → POLICY → sentinel, so an unregistered policy above POLICY is covered. */
const registry = (n: Cip113.RegistryNode): ReadonlyArray<Cip113.RegistryNode> => [
  { ...node(), keyHex: Cip113.ORIGIN_NODE_KEY, nextHex: POLICY },
  n,
]

describe("seizure", () => {
  const withList = deployment({ alwaysFailScriptHashHexes: [ALWAYS_FAIL] })

  it("is disabled when the hook is the empty-key sentinel", () => {
    const c = classifyPolicy(registry(node({ thirdPartyTransferLogicScript: Cip113.ABSENT_CRED })), withList, POLICY)
    expect(c.seizure).toEqual({ kind: "disabled" })
  })

  it("is disabled when the hook is a known always-fail script of THIS deployment", () => {
    const c = classifyPolicy(
      registry(node({ thirdPartyTransferLogicScript: { kind: "script", hashHex: ALWAYS_FAIL } })),
      withList,
      POLICY
    )
    expect(c.seizure).toEqual({ kind: "disabled" })
  })

  it("is possible when the hook is a live script and we know this deployment's always-fails", () => {
    expect(classifyPolicy(registry(node()), withList, POLICY).seizure).toEqual({
      kind: "possible",
      logic: { kind: "script", hashHex: TP },
    })
  })

  it("⚠️ is UNKNOWN, not disabled, when the deployment lists no always-fail hashes", () => {
    // The distinction the module exists for. With no list we cannot tell a live hook from a
    // bespoke always-fail, and "disabled" on a guess is the answer that misleads.
    const c = classifyPolicy(registry(node()), deployment({ alwaysFailScriptHashHexes: undefined }), POLICY)
    expect(c.seizure).toEqual({ kind: "unknown", logic: { kind: "script", hashHex: TP } })
    const empty = classifyPolicy(registry(node()), deployment({ alwaysFailScriptHashHexes: [] }), POLICY)
    expect(empty.seizure).toEqual({ kind: "unknown", logic: { kind: "script", hashHex: TP } })
  })

  it("reports a key-credential hook as possible — a signature can still seize", () => {
    const c = classifyPolicy(
      registry(node({ thirdPartyTransferLogicScript: { kind: "key", hashHex: TP } })),
      withList,
      POLICY
    )
    expect(c.seizure).toEqual({ kind: "possible", logic: { kind: "key", hashHex: TP } })
  })
})

describe("unfracking", () => {
  it("is forbidden on the empty-key sentinel — default-deny, not 'unset'", () => {
    const c = classifyPolicy(registry(node({ unfrackingLogicScript: Cip113.ABSENT_CRED })), deployment(), POLICY)
    expect(c.unfracking).toEqual({ kind: "forbidden" })
  })

  it("is delegated to a script hook", () => {
    expect(classifyPolicy(registry(node()), deployment(), POLICY).unfracking).toEqual({
      kind: "delegated",
      logic: { kind: "script", hashHex: UF },
    })
  })

  it("is signature-gated on a key credential", () => {
    const c = classifyPolicy(
      registry(node({ unfrackingLogicScript: { kind: "key", hashHex: UF } })),
      deployment(),
      POLICY
    )
    expect(c.unfracking).toEqual({ kind: "signature-gated", logic: { kind: "key", hashHex: UF } })
  })
})

describe("transferability", () => {
  it("is known-substandard only when the CALLER says it can witness that script", () => {
    // A fact about the caller's capabilities, not about the token: the same policy is
    // known to a wallet carrying that substandard and unknown to one that is not.
    expect(classifyPolicy(registry(node()), deployment(), POLICY, new Set([TL])).transferability).toEqual({
      kind: "known-substandard",
      scriptHashHex: TL,
    })
    expect(classifyPolicy(registry(node()), deployment(), POLICY).transferability).toEqual({
      kind: "unknown-substandard",
      scriptHashHex: TL,
    })
    expect(classifyPolicy(registry(node()), deployment(), POLICY, new Set([h28("99")])).transferability).toEqual({
      kind: "unknown-substandard",
      scriptHashHex: TL,
    })
  })

  it("is signature-gated when transfer logic is a key credential", () => {
    const c = classifyPolicy(
      registry(node({ transferLogicScript: { kind: "key", hashHex: TL } })),
      deployment(),
      POLICY,
      new Set([TL])
    )
    // ⚠️ Even with the hash in the known set: a key credential is a signature, not a script, and
    // reporting it as a witnessable substandard would promise a transfer nobody can build.
    expect(c.transferability).toEqual({ kind: "signature-gated", keyHashHex: TL })
  })
})

describe("an unregistered policy", () => {
  const unregistered = h28("90")
  const c = classifyPolicy(registry(node()), deployment(), unregistered)

  it("is not a programmable token of this deployment, and carries no issuer rules", () => {
    expect(c.registration).toBe("unregistered")
    expect(c.transferability).toEqual({ kind: "not-programmable" })
    expect(c.seizure).toEqual({ kind: "disabled" })
    expect(c.unfracking).toEqual({ kind: "forbidden" })
  })

  it("reports no minting logic rather than the covering node's", () => {
    // The covering node belongs to a DIFFERENT policy. Reporting its credentials here would
    // attribute another issuer's rules to this token.
    expect(c.mintingLogic).toBeUndefined()
    expect(c.globalStateCsHex).toBeUndefined()
  })
})

describe("the classification as a whole", () => {
  it("names the deployment it is relative to, since the same policy classifies differently", () => {
    const a = classifyPolicy(registry(node()), deployment({ id: "one" }), POLICY)
    const b = classifyPolicy(registry(node()), deployment({ id: "two" }), POLICY)
    expect([a.deploymentId, b.deploymentId]).toEqual(["one", "two"])
    expect(a.policyHex).toBe(POLICY)
  })

  it("omits the global-state symbol when the policy declares none, and carries it when it does", () => {
    expect(classifyPolicy(registry(node()), deployment(), POLICY).globalStateCsHex).toBeUndefined()
    expect(
      classifyPolicy(registry(node({ globalStateCsHex: h28("c1") })), deployment(), POLICY).globalStateCsHex
    ).toBe(h28("c1"))
  })

  it("refuses an incomplete registry view rather than calling the policy unregistered", () => {
    // ⚠️ The two are different problems. A paged read that missed a node must not report every
    // policy above its last node as 'not a programmable token'.
    // A view that lost the ORIGIN node cannot cover anything below the first key it kept.
    expect(() => classifyPolicy([node()], deployment(), h28("01"))).toThrow(/no covering registry node/)
    expect(() => classifyPolicy([], deployment(), POLICY)).toThrow(/no covering registry node/)
    // ⚠️ And the opposite is NOT an incomplete view: the last node's sentinel `next` covers
    // everything above it, so a policy past the last key is genuinely unregistered.
    expect(classifyPolicy([node()], deployment(), h28("ff")).registration).toBe("unregistered")
  })
})

describe("which generation a smart wallet belongs to", () => {
  const PLB_NOW = h28("11")
  const PLB_THEN = h28("22")
  const record = deployment({
    plbScriptHashHex: PLB_NOW,
    priorGenerations: [{ id: "cf-preview-older", plbScriptHashHex: PLB_THEN, source: "CF bootstrap record" }],
  })

  it("recognises the current PLB", () => {
    expect(classifyGeneration(record, PLB_NOW)).toEqual({ kind: "current", deploymentId: record.id })
  })

  it("recognises a recorded prior generation, and says where the attribution comes from", () => {
    expect(classifyGeneration(record, PLB_THEN)).toEqual({
      kind: "prior",
      generationId: "cf-preview-older",
      source: "CF bootstrap record",
    })
  })

  it("⚠️ says unrecognised for any other script credential, rather than inventing history", () => {
    // A DEX, escrow or multisig address sharing the user's stake credential looks identical from
    // outside. Calling one a prior generation would tell a holder they once had tokens there.
    expect(classifyGeneration(record, h28("33"))).toEqual({ kind: "unrecognised" })
    expect(classifyGeneration(deployment({ plbScriptHashHex: PLB_NOW, priorGenerations: undefined }), PLB_THEN)).toEqual(
      { kind: "unrecognised" }
    )
  })
})
