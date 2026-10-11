import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Uri from "../src/Uri.js"

const parse = (uri: string) => Effect.runSync(Effect.either(Uri.parse(uri)))
const parsed = (uri: string) => Effect.runSync(Uri.parse(uri))
const reason = (uri: string) => {
  const r = parse(uri)
  if (Either.isRight(r)) throw new Error(`expected ${uri} to fail, got ${JSON.stringify(r.right)}`)
  return r.left.reason
}

/** The CIP-13 document's own examples, verbatim. */
const SPEC = {
  payment: "web+cardano:Ae2tdPwUPEZ76BjmWDTS7poTekAvNqBjgfthF92pSLSDVpRVnLP7meaFhVd",
  onePool: "web+cardano://stake?c94e6fe1123bf111b77b57994bcd836af8ba2b3aa72cfcefbec2d3d4",
  twoPools: "web+cardano://stake?POOL1=3.14159&POOL2=2.71828",
  ticker: "web+cardano://stake?COSD",
  nonStandard: "web+cardano://claim/v1?faucet_url=https%3A%2F%2Fclaim.hosky.io&code=consensus2023"
} as const

describe("the spec's own examples", () => {
  it("reads a bare address as a payment reference", () => {
    expect(parsed(SPEC.payment)).toEqual({
      authority: "payment",
      address: "Ae2tdPwUPEZ76BjmWDTS7poTekAvNqBjgfthF92pSLSDVpRVnLP7meaFhVd"
    })
  })

  it("reads a single pool with no proportion", () => {
    expect(parsed(SPEC.onePool)).toEqual({
      authority: "stake",
      pools: [{ pool: "c94e6fe1123bf111b77b57994bcd836af8ba2b3aa72cfcefbec2d3d4" }]
    })
  })

  it("reads two pools with their proportions, verbatim and in order", () => {
    expect(parsed(SPEC.twoPools)).toEqual({
      authority: "stake",
      pools: [
        { pool: "POOL1", proportion: "3.14159" },
        { pool: "POOL2", proportion: "2.71828" }
      ]
    })
  })

  it("reads a pool given by ticker", () => {
    expect(parsed(SPEC.ticker)).toEqual({ authority: "stake", pools: [{ pool: "COSD" }] })
  })

  it("refuses a non-standard authority by name instead of guessing at it", () => {
    // CIP-13 lets anyone define `//<authority>`; this reads the standard set and says so for the
    // rest, which is what a wallet handed an unknown URI should do.
    expect(reason(SPEC.nonStandard)).toBe('unsupported authority "//claim" (standard CIP-13/134/162 only)')
  })
})

describe("payment references", () => {
  it("keeps the amount as written, in ADA", () => {
    // Not converted to lovelace here: the URI says decimal ADA, and a conversion needs to happen
    // where the decimals are known.
    expect(parsed("web+cardano:addr1xyz?amount=1.5")).toEqual({
      authority: "payment",
      address: "addr1xyz",
      amount: "1.5"
    })
  })

  it("omits the amount key when the URI carries none", () => {
    expect(parsed("web+cardano:addr1xyz")).toEqual({ authority: "payment", address: "addr1xyz" })
  })

  it("accepts the digit forms the CIP-13 grammar allows", () => {
    for (const [amount, expected] of [
      ["10", "10"],
      ["0.000001", "0.000001"],
      ["1.", "1."],
      [".5", ".5"]
    ] as const) {
      expect(parsed(`web+cardano:addr1xyz?amount=${amount}`)).toEqual({
        authority: "payment",
        address: "addr1xyz",
        amount: expected
      })
    }
  })

  it("refuses an amount with no digit in it", () => {
    // ⚠️ `?amount=` and `?amount=.` parse as text under the CIP-13 ABNF (`*digit [ "." *digit ]`
    // matches both), but neither is a number: a consumer reading either gets `NaN`, and an empty
    // amount is not the same fact as no amount at all.
    expect(reason("web+cardano:addr1xyz?amount=")).toBe('invalid amount ""')
    expect(reason("web+cardano:addr1xyz?amount=.")).toBe('invalid amount "."')
  })

  it("refuses an amount that is not a decimal number", () => {
    for (const amount of ["1.2.3", "1e6", "-1", "1,5", "abc", "1 "]) {
      expect(reason(`web+cardano:addr1xyz?amount=${amount}`)).toBe(`invalid amount "${amount}"`)
    }
  })

  it("refuses an empty address", () => {
    expect(reason("web+cardano:")).toBe("empty payment address")
    expect(reason("web+cardano:?amount=1")).toBe("empty payment address")
  })

  it("ignores query parameters it has no meaning for", () => {
    // A sender may append their own; dropping them is right, failing on them is not.
    expect(parsed("web+cardano:addr1xyz?amount=1&memo=hello")).toEqual({
      authority: "payment",
      address: "addr1xyz",
      amount: "1"
    })
  })
})

describe("stake references", () => {
  it("decodes a percent-encoded pool token", () => {
    expect(parsed("web+cardano://stake?%43%4f%53%44")).toEqual({
      authority: "stake",
      pools: [{ pool: "COSD" }]
    })
  })

  it("refuses the same pool twice, which has no single proportion", () => {
    expect(reason("web+cardano://stake?A=1&A=2")).toBe('pool "A" listed twice')
  })

  it("refuses a stake URI with no pools", () => {
    expect(reason("web+cardano://stake")).toBe("stake URI has no pools")
    expect(reason("web+cardano://stake?")).toBe("stake URI has no pools")
  })

  it("refuses an empty pool token", () => {
    expect(reason("web+cardano://stake?=1")).toBe("empty pool id in stake URI")
    expect(reason("web+cardano://stake?A=1&")).toBe("empty pool id in stake URI")
  })

  it("refuses a proportion with no digit in it, for the same reason as an amount", () => {
    expect(reason("web+cardano://stake?A=")).toBe('invalid proportion ""')
    expect(reason("web+cardano://stake?A=.")).toBe('invalid proportion "."')
  })

  it("refuses a proportion that is not a decimal number", () => {
    expect(reason("web+cardano://stake?A=1e3")).toBe('invalid proportion "1e3"')
    expect(reason("web+cardano://stake?A=-1")).toBe('invalid proportion "-1"')
  })

  it("leaves an absent proportion absent rather than defaulting it to 1", () => {
    // The spec's default is 1, but that belongs to whoever computes the distribution: a pool with
    // no proportion and a pool with `=1` are different URIs, and only one of them said 1.
    const one = parsed("web+cardano://stake?A") as Uri.StakeUri
    expect(one.pools[0]).toEqual({ pool: "A" })
    expect("proportion" in one.pools[0]!).toBe(false)
  })
})

describe("address and DRep references", () => {
  it("reads a CIP-134 address reference", () => {
    expect(parsed("web+cardano://addr/addr1xyz")).toEqual({ authority: "address", address: "addr1xyz" })
  })

  it("reads a CIP-162 DRep reference, including the predefined votes", () => {
    expect(parsed("web+cardano://drep/drep1yabc")).toEqual({ authority: "drep", drepId: "drep1yabc" })
    expect(parsed("web+cardano://drep/always_abstain")).toEqual({ authority: "drep", drepId: "always_abstain" })
  })

  it("refuses an empty reference", () => {
    expect(reason("web+cardano://addr/")).toBe("empty //addr/ address")
    expect(reason("web+cardano://drep/")).toBe("empty //drep/ id")
  })
})

describe("the scheme", () => {
  it("refuses anything else", () => {
    for (const uri of ["bitcoin:1abc", "cardano:addr1xyz", "https://example.com", ""]) {
      expect(reason(uri)).toBe("not a web+cardano: URI")
    }
  })

  it("reports the scheme without parsing", () => {
    expect(Uri.isCardanoUri("web+cardano:addr1xyz")).toBe(true)
    expect(Uri.isCardanoUri("web+cardano://stake?A")).toBe(true)
    expect(Uri.isCardanoUri("bitcoin:1abc")).toBe(false)
  })
})

describe("Uri.build", () => {
  const ROUND_TRIP = [
    SPEC.payment,
    "web+cardano:addr1xyz?amount=1.5",
    SPEC.onePool,
    SPEC.twoPools,
    SPEC.ticker,
    "web+cardano://addr/addr1xyz",
    "web+cardano://drep/drep1yabc"
  ] as const

  for (const uri of ROUND_TRIP) {
    it(`rebuilds ${uri.slice(0, 40)} from what it parsed`, () => {
      expect(Uri.build(parsed(uri))).toBe(uri)
    })
  }

  it("builds a stake URI from more pools than it was given at once", () => {
    expect(Uri.build({ authority: "stake", pools: [{ pool: "A", proportion: "1" }, { pool: "B" }] })).toBe(
      "web+cardano://stake?A=1&B"
    )
  })
})
