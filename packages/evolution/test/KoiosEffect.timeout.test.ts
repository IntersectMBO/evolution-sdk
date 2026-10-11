import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as KeyHash from "../src/KeyHash.js"
import * as KoiosEffect from "../src/sdk/provider/internal/KoiosEffect.js"
import * as KoiosQuery from "../src/sdk/provider/internal/KoiosQuery.js"
import * as KoiosProvider from "../src/sdk/provider/Koios.js"

/**
 * The per-request timeout, and that a caller can move it.
 *
 * ⚠️ Real time, not a fake clock, and deliberately: `Effect.timeout` races the request against
 * Effect's own Clock, so a test that advances a stubbed `setTimeout` can pass while the real
 * race is wired wrong. The delays here are tens of milliseconds, which is cheap enough to pay
 * for driving the mechanism that actually ships.
 */

const BASE = "http://koios.test"
const ADDR =
  "addr_test1qp8wl3hnya9l94rt58ky533deyqe9t8zz5n9su26k8e5g23yar4q0adtaax9q9g0kphpv2ws7vxqwu6ln6pqx7j29nfqnle9hh"

/** A Koios that answers an empty UTxO list after `delayMs`. */
const slowStub = (delayMs: number) => {
  vi.stubGlobal("fetch", async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
  })
}

/**
 * A Koios that answers `fullPages` worth of rows and then a short page, each after `delayMs`.
 * Returns how many requests were made, which is what tells a per-page ceiling from a per-walk one.
 */
const pagedStub = (delayMs: number, fullPages: number) => {
  let calls = 0
  // An `_extended: true` listing row. `is_spent: true` so the walk's own filter drops them all
  // and the assertion is about how many REQUESTS were made, not about row mapping.
  const row = {
    tx_hash: "aa".repeat(32),
    tx_index: 0,
    address: ADDR,
    value: "2000000",
    is_spent: true,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: []
  }
  vi.stubGlobal("fetch", async () => {
    const n = calls++
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    // `PAGE_SIZE` rows keeps the walk going; fewer ends it.
    const rows = n < fullPages ? Array.from({ length: 1000 }, () => row) : []
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return () => calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the per-request timeout", () => {
  it("is 10 s when a caller sets none, and the public constant says so", () => {
    expect(KoiosEffect.DEFAULT_REQUEST_TIMEOUT_MS).toBe(10_000)
    // Re-exported from the public module because `KoiosEffect` is internal: a consumer raising
    // the ceiling cannot otherwise name what it is raising it from.
    expect(KoiosProvider.DEFAULT_REQUEST_TIMEOUT_MS).toBe(KoiosEffect.DEFAULT_REQUEST_TIMEOUT_MS)
  })

  it("fails the read as a ProviderError when the request outlasts it", async () => {
    slowStub(200)
    const result = await Effect.runPromise(
      Effect.either(KoiosEffect.getUtxos(BASE, undefined, 10)(CoreAddress.fromBech32(ADDR)))
    )
    expect(result._tag).toBe("Left")
    if (result._tag !== "Left") return
    expect(result.left._tag).toBe("ProviderError")
    expect(result.left.message).toContain("getUtxos")
  })

  it("serves the SAME request when the ceiling is raised above it", async () => {
    // ⚠️ The discriminator: one stub, two ceilings, two outcomes. Without the second case the
    // first proves only that some timeout fires, not that the caller's number is the one used.
    slowStub(200)
    const utxos = await Effect.runPromise(KoiosEffect.getUtxos(BASE, undefined, 5_000)(CoreAddress.fromBech32(ADDR)))
    expect(utxos).toEqual([])
  })

  it("carries the caller's ceiling through the client, not just the bare effect", async () => {
    slowStub(200)
    const tight = new KoiosProvider.Koios(BASE, undefined, { requestTimeoutMs: 10 })
    const roomy = new KoiosProvider.Koios(BASE, undefined, { requestTimeoutMs: 5_000 })

    const refused = await Effect.runPromise(Effect.either(tight.effect.getUtxos(CoreAddress.fromBech32(ADDR))))
    expect(refused._tag).toBe("Left")
    expect(await Effect.runPromise(roomy.effect.getUtxos(CoreAddress.fromBech32(ADDR)))).toEqual([])
  })

  it("is spent PER PAGE, not across a paged walk", async () => {
    // ⚠️ The defect this placement exists for. `/credential_utxos` pages, and a ceiling wrapped
    // around the walk bounds the whole thing: three pages at 120 ms each is 360 ms, which a
    // 200 ms whole-operation ceiling refuses for being LARGE rather than slow. Per page, each
    // 120 ms page sits comfortably inside 200 ms and the walk completes.
    const pages = pagedStub(120, 3)
    const cred = KeyHash.fromHex("77".repeat(28))

    const utxos = await Effect.runPromise(KoiosEffect.getUtxos(BASE, undefined, 200)(cred))

    expect(pages()).toBe(4) // three full pages, then the short one that ends the walk
    expect(utxos).toEqual([])
  })

  it("bounds each page of a query-tier read, which had no timeout at all before", async () => {
    // `getUtxosByPaymentCredential` is one of the two UTxO strategies that carried none. A page
    // slower than the ceiling now fails as a ProviderError instead of hanging on the link.
    pagedStub(300, 3)
    const cred = KeyHash.fromHex("77".repeat(28))

    const result = await Effect.runPromise(
      Effect.either(KoiosQuery.getUtxosByPaymentCredential(BASE, undefined, 20)(cred))
    )
    expect(result._tag).toBe("Left")
    if (result._tag !== "Left") return
    expect(result.left._tag).toBe("ProviderError")
  })

  it("leaves awaitTx's own timeout alone — it is a confirmation budget, not a request ceiling", async () => {
    // `awaitTx(txHash, checkInterval, timeout)` bounds how long to WAIT for a transaction to
    // appear, across many polls. Folding the request ceiling into it would cap the wait at one
    // request's worth and report an unconfirmed transaction as a provider failure.
    const client = new KoiosProvider.Koios(BASE, undefined, { requestTimeoutMs: 10 })
    expect(client.effect.awaitTx.length).toBeGreaterThanOrEqual(1)
  })
})
