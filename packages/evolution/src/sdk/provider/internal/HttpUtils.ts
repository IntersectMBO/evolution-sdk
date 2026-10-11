import { Data, Effect, Either, ParseResult, Schema } from "effect"
import type { TimeoutException } from "effect/Cause"
import type { ParseError } from "effect/ParseResult"

import * as RequestBudget from "../RequestBudget.js"

/**
 * Raised when a request never produced a response (network failure, DNS, abort)
 */
export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
  readonly method: string
  readonly url: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Raised when a response came back but is unusable: a non-2xx status code, or a
 * body that could not be read. A body that is not the expected JSON fails decoding
 * with a ParseError instead
 */
export class HttpResponseError extends Data.TaggedError("HttpResponseError")<{
  readonly method: string
  readonly url: string
  readonly status: number
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Any failure raised by this module
 */
export type HttpError = HttpRequestError | HttpResponseError

/**
 * Request headers that carry a credential: a bearer token, a Blockfrost project id, a
 * Maestro api key. Compared case-insensitively, which is what `Headers` does.
 */
const CREDENTIAL_HEADERS = ["authorization", "project_id", "api-key"] as const

/**
 * Whether a credential may be put on this wire.
 *
 * `https` always; plain http only to loopback, where there is no wire to intercept. A LAN
 * address or a hostname is neither — an indexer one hop away on a shared network is exactly
 * where a token gets captured.
 */
const credentialMayTravel = (url: string): boolean =>
  /^https:/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)

/** The credential header this request would send, if any. */
const credentialHeaderIn = (init: RequestInit): string | undefined => {
  const headers = new Headers(init.headers ?? {})
  return CREDENTIAL_HEADERS.find((name) => headers.has(name))
}

/**
 * Every provider request passes through here, so this is where the host's request budget
 * is spent and where the traffic is reported. A host with no configured budget is counted
 * and issued immediately — the pacing is opt-in, the attribution is not.
 *
 * It is also the only place that sees both the url and the headers, which is why a
 * credential bound for a plain-http endpoint is refused here rather than by each provider:
 * a token sent in cleartext is readable by every hop it crosses, and it is a user's paid
 * tier or a wallet's identity, not a configuration detail. The request is never issued, so
 * this fails as a request that produced no response — the header is named, never its value.
 */
const sendRequest = (method: string, url: string, init: RequestInit): Effect.Effect<Response, HttpRequestError> => {
  const cleartextCredential = credentialMayTravel(url) ? undefined : credentialHeaderIn(init)
  if (cleartextCredential !== undefined) {
    return Effect.fail(
      new HttpRequestError({
        method,
        url,
        message: `refusing to send the ${cleartextCredential} header to a plain-http endpoint: ${url}`
      })
    )
  }
  return Effect.flatMap(RequestBudget.acquire(url), (waitedMs) => {
    const issuedAt = Date.now()
    const observe = (status: number, refusalBody?: string) =>
      RequestBudget.report({
        host: RequestBudget.hostKey(url),
        path: RequestBudget.requestPath(url),
        method,
        status,
        waitedMs,
        ms: Date.now() - issuedAt,
        inWindow: RequestBudget.windowCount(url),
        ...(refusalBody !== undefined ? { refusalBody } : {})
      })

    /**
     * A refusal is reported with its body, because the status alone does not identify it —
     * Koios's two different 429s are told apart by the text. Read from a CLONE, so the
     * caller still gets an unread body to fail with; an unreadable one leaves `refusalBody`
     * absent rather than reporting an empty string it never sent.
     */
    const observeResponse = (response: Response) =>
      response.ok
        ? Effect.sync(() => observe(response.status))
        : Effect.flatMap(
            Effect.either(Effect.tryPromise({ try: () => response.clone().text(), catch: (cause) => cause })),
            (body) => Effect.sync(() => observe(response.status, Either.getOrUndefined(body)))
          )

    return Effect.tryPromise({
      // Aborts the in-flight request on interruption, so Effect.timeout releases the connection
      try: (signal) => fetch(url, { ...init, method, signal }),
      catch: (cause) => new HttpRequestError({ method, url, message: `${method} ${url} failed`, cause })
    }).pipe(
      Effect.tap(observeResponse),
      // A request that never produced a response is still spent budget, and is the one a
      // 429 investigation most needs to see.
      Effect.tapError(() => Effect.sync(() => observe(0)))
    )
  })
}

/**
 * Read the response body as text, failing on non-2xx status codes
 */
const readOkBody = (method: string, url: string, response: Response): Effect.Effect<string, HttpResponseError> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new HttpResponseError({
        method,
        url,
        status: response.status,
        message: "failed to read response body",
        cause
      })
  }).pipe(
    Effect.flatMap((text) =>
      response.ok
        ? Effect.succeed(text)
        : Effect.fail(
            new HttpResponseError({
              method,
              url,
              status: response.status,
              message: `non 2xx status code : ${text}`
            })
          )
    )
  )

/**
 * `JSON.parse` reviver that hands every number to the schema as the exact text the server
 * wrote, so integer fields decode with `Schema.BigInt` at any size and decimal fields with
 * `Schema.NumberFromString`. Where the runtime gives no source text, `String(value)` is still
 * exact for safe integers and decimals; only an integer past 2^53 cannot be recovered
 */
const numberAsText = (_key: string, value: unknown, context?: { readonly source?: string }): unknown => {
  if (typeof value !== "number") return value
  if (context?.source !== undefined) return context.source
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new SyntaxError(`cannot read ${value} exactly on this runtime`)
  }
  return String(value)
}

/**
 * JSON text to a value in which every number is its exact source text
 */
const Json = Schema.parseJson({ reviver: numberAsText })

const rawJSON: unknown = Reflect.get(JSON, "rawJSON")

/**
 * A uint64 amount, written as a raw JSON integer
 */
export const BigIntFromJsonNumber = Schema.transformOrFail(
  Schema.Union(Schema.String, Schema.Object),
  Schema.BigIntFromSelf,
  {
    strict: true,
    decode: (value, _, ast) =>
      typeof value === "string" && /^-?\d+$/.test(value)
        ? ParseResult.succeed(BigInt(value))
        : ParseResult.fail(new ParseResult.Type(ast, value, "expected integer digits")),
    encode: (value, _, ast) =>
      typeof rawJSON === "function"
        ? ParseResult.succeed(rawJSON(value.toString()))
        : ParseResult.fail(new ParseResult.Type(ast, value, "this runtime cannot write integers past 2^53 exactly"))
  }
)

/**
 * Set caller headers over a default content type. Header names are case-insensitive,
 * so a caller's `content-type` replaces the default instead of being joined to it
 */
const withContentType = (contentType: string, headers?: Record<string, string>): Headers => {
  const merged = new Headers({ "Content-Type": contentType })
  for (const [name, value] of Object.entries(headers ?? {})) merged.set(name, value)
  return merged
}

/**
 * Bound ONE request, when a caller asked for a bound.
 *
 * ⚠️ Optional with no default on purpose. `HttpUtils` is shared by every provider — Blockfrost,
 * Maestro, Kupmios and Ogmios as well as Koios — so a default here would silently put a ceiling on
 * four providers that never asked for one. A provider opts in by threading its own value down.
 *
 * ⚠️ Per REQUEST, which is the whole point of its being here rather than around an operation: a
 * paged walk calls this once per page, so each page gets the full ceiling and a long walk is not
 * cut off for being long. A timeout wrapped around `pageAll` instead bounds the walk — which is
 * what `getUtxos` over a *credential* used to do, three requests under one ceiling.
 */
const bound = <A, E, R>(effect: Effect.Effect<A, E, R>, timeoutMs?: number) =>
  timeoutMs === undefined ? effect : Effect.timeout(effect, timeoutMs)

const requestJson = <A, I, R>(
  method: string,
  url: string,
  schema: Schema.Schema<A, I, R>,
  init: RequestInit,
  timeoutMs?: number
): Effect.Effect<A, HttpError | ParseError | TimeoutException, R> =>
  bound(
    sendRequest(method, url, init).pipe(
      Effect.flatMap((response) => readOkBody(method, url, response)),
      Effect.flatMap(Schema.decodeUnknown(Schema.compose(Json, schema)))
    ),
    timeoutMs
  )

/**
 * Performs a GET request and decodes the response using the provided schema
 */
export const get = <A, I, R>(
  url: string,
  schema: Schema.Schema<A, I, R>,
  headers?: Record<string, string>,
  timeoutMs?: number
) => requestJson("GET", url, schema, headers ? { headers } : {}, timeoutMs)

/**
 * Performs a POST request with JSON body and decodes the response using the provided schema
 */
export const postJson = <A, I, R>(
  url: string,
  body: unknown,
  schema: Schema.Schema<A, I, R>,
  headers?: Record<string, string>,
  timeoutMs?: number
) =>
  requestJson(
    "POST",
    url,
    schema,
    {
      headers: withContentType("application/json", headers),
      body: JSON.stringify(body)
    },
    timeoutMs
  )

/**
 * Performs a POST request with Uint8Array body and decodes the response using the provided schema
 */
export const postUint8Array = <A, I>(
  url: string,
  body: Uint8Array,
  schema: Schema.Schema<A, I>,
  headers?: Record<string, string>,
  timeoutMs?: number
) =>
  bound(
    sendRequest("POST", url, {
      headers: withContentType("application/cbor", headers),
      // BodyInit excludes SharedArrayBuffer-backed views; transaction bytes are never shared
      body: body as BodyInit
    }),
    timeoutMs
  ).pipe(
    Effect.flatMap((response) => readOkBody("POST", url, response)),
    // Try JSON first, fall back to plain text for endpoints that return unquoted strings (e.g. Dolos /tx/submit)
    Effect.map((text): unknown => Either.getOrElse(Schema.decodeUnknownEither(Json)(text), () => text)),
    Effect.flatMap(Schema.decodeUnknown(schema))
  )
