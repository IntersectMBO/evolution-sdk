import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as Body from "../src/Body.js"
import * as NativeScript from "../src/NativeScript.js"

const KH = (n: string) => n.repeat(28)
const IN32 = "11".repeat(32)
const RA = `581d${"e0"}${"ab".repeat(28)}`
const PREFIX = `00d9010281825820${IN32}000180021a000f4240`
const bodyWith = (keyHex: string, valueHex: string) => `a4${PREFIX}${keyHex}${valueHex}`

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runSync(eff)

/** The typed failure, not the thrown wrapper: `runSync` reports every defect as the same text. */
const reasonOf = <A>(eff: Effect.Effect<A, Body.DijkstraError>): string => {
  const e = Effect.runSync(Effect.either(eff))
  if (e._tag === "Right") throw new Error("expected a failure, got a value")
  return e.left.reason
}

describe("guards (body key 14)", () => {
  // ⚠️ The two forms are a fact about the transaction, not an encoding detail: the key-hash set
  // is the back-compatible `required_signers` shape. Which one was used is reported, not
  // normalised away.
  it("reads a key-hash set", () => {
    const got = run(Body.guards(bodyWith("0e", `d9010282581c${KH("11")}581c${KH("22")}`)))
    expect(got).toEqual({ form: "keyhash", keyHashes: [KH("11"), KH("22")] })
  })

  it("reads a credential oset", () => {
    const got = run(Body.guards(bodyWith("0e", `d901028282 00581c${KH("44")}8201581c${KH("55")}`.replace(/ /g, ""))))
    expect(got).toEqual({
      form: "credential",
      credentials: [
        { hashHex: KH("44"), isScript: false },
        { hashHex: KH("55"), isScript: true }
      ]
    })
  })

  it("reports an absent field as absent, not as empty", () => {
    expect(run(Body.guards(`a3${PREFIX}`))).toBeUndefined()
  })

  // ⚠️ An empty set has no element to read the form from, so the form has to be chosen. It is
  // reported as the back-compatible key-hash shape, matching an empty `required_signers`.
  it("reports an empty set as the key-hash form", () => {
    expect(run(Body.guards(bodyWith("0e", "d9010280")))).toEqual({ form: "keyhash", keyHashes: [] })
    expect(run(Body.guards(bodyWith("0e", "80")))).toEqual({ form: "keyhash", keyHashes: [] })
  })
})

describe("account_balance_interval has three arms and they stay distinct", () => {
  // ⚠️ The CDDL does not say what the bare `coin` form constrains, so collapsing it into an
  // interval would be inventing a meaning.
  it("reads a bare coin as a coin", () => {
    expect(run(Body.accountBalanceIntervals(bodyWith("181a", `a1${RA}1a000f4240`)))).toEqual([
      { rewardAccountHex: `e0${"ab".repeat(28)}`, bound: { form: "coin", coin: 1000000n } }
    ])
  })

  it("reads each half-open interval", () => {
    expect(run(Body.accountBalanceIntervals(bodyWith("181a", `a1${RA}820af6`)))?.[0]!.bound).toEqual({
      form: "interval",
      lower: 10n
    })
    expect(run(Body.accountBalanceIntervals(bodyWith("181a", `a1${RA}82f618ff`)))?.[0]!.bound).toEqual({
      form: "interval",
      upper: 255n
    })
  })

  it("refuses [nil, nil], which constrains nothing", () => {
    expect(reasonOf(Body.accountBalanceIntervals(bodyWith("181a", `a1${RA}82f6f6`)))).toMatch(/both bounds are nil/)
  })
})

describe("sub_transactions keep their bytes", () => {
  // ⚠️ A nested body that is re-encoded is a different transaction id, so these are raw.
  it("returns each nested transaction verbatim", () => {
    const sub = "83a0a0f6"
    expect(run(Body.subTransactions(bodyWith("17", `82${sub}${sub}`)))).toEqual([sub, sub])
  })

  it("splits a 3-tuple and round-trips through assemble3Tuple", () => {
    const tx = Body.assemble3Tuple("a0", "a1006161", undefined)
    const split = run(Body.splitTx(tx))
    expect(split).toEqual({ bodyHex: "a0", witnessHex: "a1006161" })
    expect(Body.assemble3Tuple(split.bodyHex, split.witnessHex, split.auxHex)).toBe(tx)
  })

  it("refuses a 4-tuple rather than guessing which one it is", () => {
    // ⚠️ A 4-tuple is either the back-compat mempool form or a block_transaction, and this
    // cannot tell them apart -- so it names that instead of picking one.
    expect(reasonOf(Body.splitTx("84a0a0f5f6"))).toMatch(/3-tuple/)
  })
})

describe("a truncated body is not a body with absent fields", () => {
  // ⚠️ Reading past the end used to yield a phantom zero-length uint, so a truncated body walked
  // to its end matching no key and every reader called its field ABSENT.
  //
  // `past the end` is the shared decoder refusing it now: `CBOR.decodeItemAt` bounds-checks its
  // offset, so the same class is caught one layer down as well. The alternation is about WHICH
  // layer refuses, and the assertion is that one of them does.
  for (const [label, hex] of [
    ["truncated after a key", "a40e"],
    ["truncated mid-value", "a40e82"],
    ["empty", ""]
  ] as const) {
    it(`refuses ${label}`, () => {
      expect(reasonOf(Body.directDeposits(hex))).toMatch(/end of input|past the end|not a CBOR map|not hex/)
      expect(reasonOf(Body.subTransactions(hex))).toMatch(/end of input|past the end|not a CBOR map|not hex/)
    })
  }
})

describe("script_require_guard (native-script tag 6)", () => {
  // The draft ledger CDDL byte form. No library ships Dijkstra, so this vector IS the oracle.
  //   script_require_guard = (6, credential); credential = [0, addr_keyhash] / [1, script_hash]
  it("builds the CDDL vector for a key hash", () => {
    expect(NativeScript.requireGuardHex({ hashHex: KH("11"), isScript: false })).toBe(`82068200581c${KH("11")}`)
  })

  it("builds the CDDL vector for a script hash", () => {
    expect(NativeScript.requireGuardHex({ hashHex: KH("22"), isScript: true })).toBe(`82068201581c${KH("22")}`)
  })

  it("round-trips", () => {
    for (const isScript of [false, true]) {
      const cred = { hashHex: KH("33"), isScript }
      expect(NativeScript.decodeRequireGuard(NativeScript.requireGuardHex(cred))).toEqual(cred)
    }
  })

  // ⚠️ Declines rather than throws: the caller's own decoder owns every other arm, and this is
  // the one variant it could not name.
  it("declines another native-script variant instead of claiming it", () => {
    expect(NativeScript.decodeRequireGuard(`8200581c${KH("44")}`)).toBeUndefined() // pubkey, tag 0
    expect(NativeScript.decodeRequireGuard("8205190063")).toBeUndefined() // invalid_hereafter, tag 5
  })

  it("refuses a credential hash that is not 28 bytes", () => {
    expect(() => NativeScript.requireGuardHex({ hashHex: "aa", isScript: false })).toThrow(/28 bytes/)
    expect(() => NativeScript.decodeRequireGuard("820682004101")).toThrow(/28/)
  })
})
