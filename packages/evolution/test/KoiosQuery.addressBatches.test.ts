import { Effect, Either } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as KoiosQuery from "../src/sdk/provider/internal/KoiosQuery.js"

/**
 * `splitAddressesForTxsAt` is the batching `getTxsAt` itself applies, published because a caller
 * that pages has to agree with it exactly.
 *
 * ⚠️ Why it is published rather than documented. `getTxsAt` REFUSES an `offset` across a split
 * body — the only correct answer, since a global window over several address streams costs
 * quadratic work. So a caller that pages must batch under the budget, and a budget restated
 * beside the caller is a budget that drifts: a count that fits one address length splits at
 * another. A consuming wallet shipped exactly that, and every history window it walked was
 * refused before a request went out.
 */

const BASE = "http://koios.test"

/** Distinct mainnet base addresses (header 0x01, payment hash, stake hash). */
const addresses = (n: number): Array<CoreAddress.Address> =>
  Array.from({ length: n }, (_, i) =>
    CoreAddress.fromHex(`01${(i + 1).toString(16).padStart(2, "0").repeat(28)}${"cd".repeat(28)}`)
  )

const stub = () => {
  const urls: Array<string> = []
  vi.stubGlobal("fetch", async (input: unknown) => {
    urls.push(String(input))
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return urls
}

const page = (addrs: ReadonlyArray<CoreAddress.Address>) =>
  Effect.either(KoiosQuery.getTxsAt(BASE)(addrs, { offset: 0, limit: 1000 }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the address batches getTxsAt can serve", () => {
  it("each go out as exactly one request, with an offset", async () => {
    const batches = KoiosQuery.splitAddressesForTxsAt(addresses(120))
    expect(batches.length).toBeGreaterThan(1)

    for (const batch of batches) {
      const urls = stub()
      const outcome = await Effect.runPromise(page(batch))

      expect(Either.isRight(outcome)).toBe(true)
      expect(urls).toHaveLength(1)
      vi.unstubAllGlobals()
    }
  })

  it("partition the input in order, so a caller loses no address and repeats none", () => {
    const input = addresses(95)

    const flat = KoiosQuery.splitAddressesForTxsAt(input).flat()

    expect(flat.map(CoreAddress.toBech32)).toStrictEqual(input.map(CoreAddress.toBech32))
  })

  it("keep a repeated address repeated, which a map keyed on the bech32 would collapse", () => {
    const one = addresses(1)[0]!

    const flat = KoiosQuery.splitAddressesForTxsAt([one, one, one]).flat()

    expect(flat).toHaveLength(3)
  })

  it("are as large as the budget allows: one address more is refused before a request", async () => {
    const first = KoiosQuery.splitAddressesForTxsAt(addresses(120))[0]!
    const urls = stub()

    const outcome = await Effect.runPromise(page([...first, ...addresses(121).slice(120)]))

    expect(Either.isLeft(outcome)).toBe(true)
    expect(urls).toHaveLength(0)
  })
})
