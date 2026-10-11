/**
 * The epoch-params cache on the Koios client.
 *
 * ⚠️ **It is the client's, not a caller's.** Protocol parameters change only at an epoch
 * boundary (~5 days) and every transaction build reads them, so one window's worth of requests
 * collapses to one — measured on a device before the cache existed: 11 `/epoch_params` requests
 * inside 60 seconds. It sits here rather than in a wallet adapter because only the client sees
 * every caller: a wallet, a dApp bridge and a CIP-113 transfer all build transactions, and a
 * cache one of them holds does nothing for the other two.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EPOCH_PARAMS_TTL_MS, epochParamsFresh, Koios } from "../../src/sdk/provider/Koios.js"

const BASE_URL = "https://koios.test/api/v1"
const ROW = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "koios", "epoch_params.json"), "utf8"))[0]

/** Counts requests and answers every one with the same parameter row. */
const counting = () => {
  const calls = { n: 0 }
  vi.stubGlobal("fetch", async () => {
    calls.n += 1
    return new Response(JSON.stringify([ROW]), { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("epochParamsFresh", () => {
  it("is fresh within the TTL and stale at or after it", () => {
    const at = 1_000_000
    expect(epochParamsFresh(at, at)).toBe(true)
    expect(epochParamsFresh(at, at + EPOCH_PARAMS_TTL_MS - 1)).toBe(true)
    expect(epochParamsFresh(at, at + EPOCH_PARAMS_TTL_MS)).toBe(false)
    expect(epochParamsFresh(at, at + EPOCH_PARAMS_TTL_MS + 1)).toBe(false)
  })

  it("holds a TTL well under an epoch, so a cached set never goes stale mid-epoch", () => {
    expect(EPOCH_PARAMS_TTL_MS).toBeLessThan(5 * 24 * 60 * 60 * 1000)
  })
})

describe("Koios.getProtocolParameters", () => {
  it("answers a second read from the cache, not from a second request", async () => {
    const calls = counting()
    const koios = new Koios(BASE_URL)

    const first = await Effect.runPromise(koios.effect.getProtocolParameters())
    const second = await Effect.runPromise(koios.effect.getProtocolParameters())

    expect(calls.n).toBe(1)
    expect(second).toEqual(first)
  })

  it("refetches once the TTL has elapsed, so an epoch boundary is picked up", async () => {
    const calls = counting()
    vi.useFakeTimers()
    const koios = new Koios(BASE_URL)

    await Effect.runPromise(koios.effect.getProtocolParameters())
    vi.advanceTimersByTime(EPOCH_PARAMS_TTL_MS + 1)
    await Effect.runPromise(koios.effect.getProtocolParameters())

    expect(calls.n).toBe(2)
  })

  it("holds the cache PER INSTANCE, so one provider never answers with another's parameters", async () => {
    // ⚠️ A module-level map keyed on the base URL leaks across providers, networks and tests.
    // Two instances on the same URL are still two providers.
    const calls = counting()

    await Effect.runPromise(new Koios(BASE_URL).effect.getProtocolParameters())
    await Effect.runPromise(new Koios(BASE_URL).effect.getProtocolParameters())

    expect(calls.n).toBe(2)
  })

  it("does not cache a failure — a refused read must not become the answer for 30 minutes", async () => {
    let n = 0
    vi.stubGlobal("fetch", async () => {
      n += 1
      return n === 1
        ? new Response("rate limited", { status: 429 })
        : new Response(JSON.stringify([ROW]), { status: 200, headers: { "Content-Type": "application/json" } })
    })
    const koios = new Koios(BASE_URL)

    const refused = await Effect.runPromiseExit(koios.effect.getProtocolParameters())
    expect(refused._tag).toBe("Failure")

    // The second read asks again and succeeds, rather than replaying the refusal.
    const params = await Effect.runPromise(koios.effect.getProtocolParameters())
    expect(params.minFeeA).toBeTypeOf("number")
  })
})
