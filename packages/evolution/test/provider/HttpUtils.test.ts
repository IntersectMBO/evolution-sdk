/**
 * Unit tests for the fetch-based HTTP helpers shared by every provider.
 *
 * These run offline: `fetch` is stubbed, so they cover the request shape and the
 * error mapping that `BlockfrostEffect.is404Error` and the provider error
 * wrappers depend on, without needing an API key.
 */
import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as HttpUtils from "../../src/sdk/provider/internal/HttpUtils.js"

const PointSchema = Schema.Struct({ slot: Schema.Number })

const stubFetch = (response: Response | Promise<Response> | Error) => {
  const fetchMock = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const lastInit = (fetchMock: ReturnType<typeof stubFetch>) =>
  (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]

const lastHeaders = (fetchMock: ReturnType<typeof stubFetch>) => lastInit(fetchMock).headers as Record<string, string>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("HttpUtils.get", () => {
  it("decodes a 2xx JSON body with the schema", async () => {
    const fetchMock = stubFetch(jsonResponse({ slot: 42 }))

    const result = await Effect.runPromise(HttpUtils.get("https://example.test/point", PointSchema))

    expect(result).toEqual({ slot: 42 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/point")
    expect(lastInit(fetchMock).method).toBe("GET")
  })

  it("forwards caller headers", async () => {
    const fetchMock = stubFetch(jsonResponse({ slot: 1 }))

    await Effect.runPromise(HttpUtils.get("https://example.test/point", PointSchema, { Authorization: "Bearer t" }))

    expect(lastHeaders(fetchMock)).toMatchObject({ Authorization: "Bearer t" })
  })

  it("fails with HttpResponseError carrying the status and body on non-2xx", async () => {
    stubFetch(new Response("not found", { status: 404 }))

    const error = await Effect.runPromise(Effect.flip(HttpUtils.get("https://example.test/point", PointSchema)))

    expect(error).toBeInstanceOf(HttpUtils.HttpResponseError)
    const responseError = error as HttpUtils.HttpResponseError
    expect(responseError.status).toBe(404)
    // Blockfrost maps 404 to "not found" via this status, and the message text is
    // surfaced through ProviderError.cause
    expect(responseError.message).toBe("non 2xx status code : not found")
  })

  it("fails with HttpResponseError when a 2xx body is not JSON", async () => {
    stubFetch(new Response("<html>maintenance</html>", { status: 200 }))

    const error = await Effect.runPromise(Effect.flip(HttpUtils.get("https://example.test/point", PointSchema)))

    expect(error).toBeInstanceOf(HttpUtils.HttpResponseError)
    expect((error as HttpUtils.HttpResponseError).message).toBe("failed to parse response as JSON")
  })

  it("aborts the in-flight request when the effect is interrupted", async () => {
    // Providers wrap these calls in Effect.timeout; without a signal the socket
    // would stay open until the server answered
    let captured: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      captured = init.signal ?? undefined
      return new Promise<Response>(() => {}) // never settles
    })
    vi.stubGlobal("fetch", fetchMock)

    const exit = await Effect.runPromiseExit(
      HttpUtils.get("https://example.test/slow", PointSchema).pipe(Effect.timeout(10))
    )

    expect(exit._tag).toBe("Failure")
    expect(captured).toBeInstanceOf(AbortSignal)
    expect(captured?.aborted).toBe(true)
  })

  it("fails with HttpRequestError when the request never lands", async () => {
    stubFetch(new TypeError("network down"))

    const error = await Effect.runPromise(Effect.flip(HttpUtils.get("https://example.test/point", PointSchema)))

    expect(error).toBeInstanceOf(HttpUtils.HttpRequestError)
    expect((error as HttpUtils.HttpRequestError).url).toBe("https://example.test/point")
  })
})

describe("HttpUtils.postJson", () => {
  it("sends a JSON body with the JSON content type", async () => {
    const fetchMock = stubFetch(jsonResponse({ slot: 7 }))

    const result = await Effect.runPromise(
      HttpUtils.postJson("https://example.test/query", { _addresses: ["addr"] }, PointSchema)
    )

    expect(result).toEqual({ slot: 7 })
    expect(lastInit(fetchMock).method).toBe("POST")
    expect(lastInit(fetchMock).body).toBe(JSON.stringify({ _addresses: ["addr"] }))
    expect(lastHeaders(fetchMock)["Content-Type"]).toBe("application/json")
  })

  it("lets caller headers override the content type", async () => {
    const fetchMock = stubFetch(jsonResponse({ slot: 7 }))

    await Effect.runPromise(
      HttpUtils.postJson("https://example.test/query", {}, PointSchema, { "Content-Type": "application/custom" })
    )

    expect(lastHeaders(fetchMock)["Content-Type"]).toBe("application/custom")
  })
})

describe("HttpUtils.postUint8Array", () => {
  const bytes = new Uint8Array([1, 2, 3])

  it("posts raw bytes as CBOR and decodes a JSON response", async () => {
    const fetchMock = stubFetch(jsonResponse("abc123"))

    const result = await Effect.runPromise(
      HttpUtils.postUint8Array("https://example.test/tx/submit", bytes, Schema.String)
    )

    expect(result).toBe("abc123")
    expect(lastHeaders(fetchMock)["Content-Type"]).toBe("application/cbor")
    expect(lastInit(fetchMock).body).toBe(bytes)
  })

  it("falls back to plain text for endpoints returning an unquoted string", async () => {
    // e.g. Dolos /tx/submit, which returns a bare tx hash rather than JSON
    stubFetch(new Response("abc123", { status: 200 }))

    const result = await Effect.runPromise(
      HttpUtils.postUint8Array("https://example.test/tx/submit", bytes, Schema.String)
    )

    expect(result).toBe("abc123")
  })

  it("surfaces non-2xx as HttpResponseError", async () => {
    stubFetch(new Response("bad tx", { status: 400 }))

    const error = await Effect.runPromise(
      Effect.flip(HttpUtils.postUint8Array("https://example.test/tx/submit", bytes, Schema.String))
    )

    expect(error).toBeInstanceOf(HttpUtils.HttpResponseError)
    expect((error as HttpUtils.HttpResponseError).status).toBe(400)
  })
})
