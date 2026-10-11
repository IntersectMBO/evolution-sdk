import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { Effect, Schema } from "effect"

import * as HttpUtils from "../src/sdk/provider/internal/HttpUtils.js"
import * as RequestBudget from "../src/sdk/provider/RequestBudget.js"

const KOIOS = "https://api.koios.rest/api/v1/address_utxos?_extended=true"
const OTHER = "https://cardano-preprod.blockfrost.io/api/v0/blocks/latest"

beforeEach(() => {
  RequestBudget.reset()
  RequestBudget.setObserver(null)
})

afterEach(() => {
  RequestBudget.reset()
  RequestBudget.setObserver(null)
  vi.unstubAllGlobals()
})

describe("RequestBudget – the key and the pure rule", () => {
  it("keys on the origin, and groups by path with the query dropped", () => {
    expect(RequestBudget.hostKey(KOIOS)).toBe("https://api.koios.rest")
    expect(RequestBudget.hostKey(OTHER)).toBe("https://cardano-preprod.blockfrost.io")
    expect(RequestBudget.requestPath(KOIOS)).toBe("/api/v1/address_utxos")
    expect(RequestBudget.requestPath("https://api.koios.rest")).toBe("/")
  })

  it("degrades a url it cannot parse to itself rather than throwing", () => {
    expect(RequestBudget.hostKey("not a url")).toBe("not a url")
  })

  it("goes now while there is room, and waits for the oldest to age out when there is not", () => {
    const window = { recent: [1_000, 1_500], limit: 3, windowMs: 1_000 }
    expect(RequestBudget.throttleDelayMs(window, 2_000)).toBe(0)

    const full = { recent: [1_800, 1_900], limit: 2, windowMs: 1_000 }
    expect(RequestBudget.throttleDelayMs(full, 2_000)).toBe(800)
  })

  it("ignores issue times that have aged out, in both directions", () => {
    const allStale = { recent: [10, 20, 30], limit: 2, windowMs: 1_000 }
    expect(RequestBudget.throttleDelayMs(allStale, 5_000)).toBe(0)

    // The one that matters: counting the stale entry would make the window look full and
    // then read the wait off an issue time from last week, which is always "go now".
    const mixed = { recent: [10, 4_900, 4_950], limit: 2, windowMs: 1_000 }
    expect(RequestBudget.throttleDelayMs(mixed, 5_000)).toBe(900)
  })
})

describe("RequestBudget – pacing", () => {
  it("counts an unconfigured host without holding it back", async () => {
    const started = Date.now()
    for (let i = 0; i < 20; i++) await Effect.runPromise(RequestBudget.acquire(KOIOS))

    expect(Date.now() - started).toBeLessThan(200)
    expect(RequestBudget.windowCount(KOIOS)).toBe(20)
    expect(RequestBudget.budgetFor(KOIOS)).toBeUndefined()
  })

  it("holds the request that would exceed the allowance", async () => {
    RequestBudget.configure("https://api.koios.rest", { limit: 2, windowMs: 200 })

    await Effect.runPromise(RequestBudget.acquire(KOIOS))
    await Effect.runPromise(RequestBudget.acquire(KOIOS))
    const waited = await Effect.runPromise(RequestBudget.acquire(KOIOS))

    expect(waited).toBeGreaterThanOrEqual(100)
  })

  it("serialises a concurrent burst instead of waving it all through one free slot", async () => {
    RequestBudget.configure("https://api.koios.rest", { limit: 2, windowMs: 300 })

    const waits = await Promise.all([0, 1, 2].map(() => Effect.runPromise(RequestBudget.acquire(KOIOS))))

    // Which of the three gets held is up to the scheduler; that exactly one is, is not.
    const sorted = [...waits].sort((a, b) => a - b)
    expect(sorted[0]).toBe(0)
    expect(sorted[1]).toBeLessThan(50)
    expect(sorted[2]).toBeGreaterThanOrEqual(250)
  })

  it("shares one allowance across every url on the host, and never across hosts", async () => {
    RequestBudget.configure("https://api.koios.rest", { limit: 50, windowMs: 10_000 })

    await Effect.runPromise(RequestBudget.acquire(`${KOIOS}`))
    await Effect.runPromise(RequestBudget.acquire("https://api.koios.rest/api/v1/tx_info"))
    await Effect.runPromise(RequestBudget.acquire(OTHER))

    expect(RequestBudget.windowCount("https://api.koios.rest")).toBe(2)
    expect(RequestBudget.windowCount(OTHER)).toBe(1)
  })

  it("stops pacing when the allowance is removed", async () => {
    RequestBudget.configure("https://api.koios.rest", { limit: 1, windowMs: 10_000 })
    await Effect.runPromise(RequestBudget.acquire(KOIOS))
    RequestBudget.configure("https://api.koios.rest", null)

    const waited = await Effect.runPromise(RequestBudget.acquire(KOIOS))

    expect(waited).toBe(0)
    expect(RequestBudget.budgetFor(KOIOS)).toBeUndefined()
  })
})

describe("RequestBudget – what the observer sees", () => {
  const Body = Schema.Struct({ ok: Schema.Boolean })

  it("reports the status, the volume and the time the pacer held the request back", async () => {
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    RequestBudget.configure("https://api.koios.rest", { limit: 1, windowMs: 150 })
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ ok: true }))))

    await Effect.runPromise(HttpUtils.get(KOIOS, Body))
    await Effect.runPromise(HttpUtils.get(KOIOS, Body))

    expect(seen).toHaveLength(2)
    expect(seen[0].host).toBe("https://api.koios.rest")
    expect(seen[0].path).toBe("/api/v1/address_utxos")
    expect(seen[0].method).toBe("GET")
    expect(seen[0].status).toBe(200)
    expect(seen[0].waitedMs).toBe(0)
    expect(seen[1].waitedMs).toBeGreaterThanOrEqual(100)
    expect(seen[1].inWindow).toBe(1)
  })

  it("reports a refusal, which is the request a 429 investigation needs to see", async () => {
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("rate limited", { status: 429 })))

    await expect(Effect.runPromise(HttpUtils.get(KOIOS, Body))).rejects.toThrow()

    expect(seen).toHaveLength(1)
    expect(seen[0].status).toBe(429)
    expect(seen[0].inWindow).toBe(1)
  })

  it("carries the refusal's BODY, which is what separates two refusals of the same status", async () => {
    // Koios's per-credential burst limit and an instance shedding load by source IP are both
    // 429. Only the text says which, so a report without it names no cause at all.
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("Exceeded Burst Limit, count was 103", { status: 429 })))

    await expect(Effect.runPromise(HttpUtils.get(KOIOS, Body))).rejects.toThrow()

    expect(seen[0].refusalBody).toBe("Exceeded Burst Limit, count was 103")
  })

  it("leaves the caller a body to fail with, having read the refusal from a clone", async () => {
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("upstream is down", { status: 503 })))

    // Reporting the body must not consume it: the error the caller sees carries it too.
    await expect(Effect.runPromise(HttpUtils.get(KOIOS, Body))).rejects.toThrow(/upstream is down/)

    expect(seen[0].refusalBody).toBe("upstream is down")
  })

  it("reports no body on a success, rather than an empty one", async () => {
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ ok: true }))))

    await Effect.runPromise(HttpUtils.get(KOIOS, Body))

    expect("refusalBody" in seen[0]).toBe(false)
  })

  it("reports a refusal whose body cannot be read with the body ABSENT, not empty", async () => {
    // An empty string is a body the server sent. Absent is "we could not read it", and a
    // reader that cannot tell them apart will blame the server for the client's failure.
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    vi.stubGlobal("fetch", () => {
      const response = new Response("too late", { status: 429 })
      Object.defineProperty(response, "clone", {
        value: () => {
          throw new Error("body already disturbed")
        }
      })
      return Promise.resolve(response)
    })

    await expect(Effect.runPromise(HttpUtils.get(KOIOS, Body))).rejects.toThrow()

    expect(seen[0].status).toBe(429)
    expect("refusalBody" in seen[0]).toBe(false)
  })

  it("reports a request that never produced a response at all", async () => {
    const seen: Array<RequestBudget.RequestReport> = []
    RequestBudget.setObserver((request) => seen.push(request))
    vi.stubGlobal("fetch", () => Promise.reject(new Error("dns")))

    await expect(Effect.runPromise(HttpUtils.get(KOIOS, Body))).rejects.toThrow()

    expect(seen).toHaveLength(1)
    expect(seen[0].status).toBe(0)
  })
})
