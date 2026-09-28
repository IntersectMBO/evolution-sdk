import { Data, Effect, Either, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"

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
 * body that could not be read or parsed
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

const sendRequest = (method: string, url: string, init: RequestInit): Effect.Effect<Response, HttpRequestError> =>
  Effect.tryPromise({
    // Aborts the in-flight request on interruption, so Effect.timeout releases the connection
    try: (signal) => fetch(url, { ...init, method, signal }),
    catch: (cause) => new HttpRequestError({ method, url, message: `${method} ${url} failed`, cause })
  })

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

const parseJson = (
  method: string,
  url: string,
  status: number,
  text: string
): Effect.Effect<unknown, HttpResponseError> =>
  Schema.decodeUnknown(Json)(text).pipe(
    Effect.mapError(
      (cause) =>
        new HttpResponseError({
          method,
          url,
          status,
          message: "failed to parse response as JSON",
          cause
        })
    )
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

const requestJson = <A, I, R>(
  method: string,
  url: string,
  schema: Schema.Schema<A, I, R>,
  init: RequestInit
): Effect.Effect<A, HttpError | ParseError, R> =>
  sendRequest(method, url, init).pipe(
    Effect.flatMap((response) =>
      readOkBody(method, url, response).pipe(Effect.flatMap((text) => parseJson(method, url, response.status, text)))
    ),
    Effect.flatMap(Schema.decodeUnknown(schema))
  )

/**
 * Performs a GET request and decodes the response using the provided schema
 */
export const get = <A, I, R>(url: string, schema: Schema.Schema<A, I, R>, headers?: Record<string, string>) =>
  requestJson("GET", url, schema, headers ? { headers } : {})

/**
 * Performs a POST request with JSON body and decodes the response using the provided schema
 */
export const postJson = <A, I, R>(
  url: string,
  body: unknown,
  schema: Schema.Schema<A, I, R>,
  headers?: Record<string, string>
) =>
  requestJson("POST", url, schema, {
    headers: withContentType("application/json", headers),
    body: JSON.stringify(body)
  })

/**
 * Performs a POST request with Uint8Array body and decodes the response using the provided schema
 */
export const postUint8Array = <A, I>(
  url: string,
  body: Uint8Array,
  schema: Schema.Schema<A, I>,
  headers?: Record<string, string>
) =>
  sendRequest("POST", url, {
    headers: withContentType("application/cbor", headers),
    // BodyInit excludes SharedArrayBuffer-backed views; transaction bytes are never shared
    body: body as BodyInit
  }).pipe(
    Effect.flatMap((response) => readOkBody("POST", url, response)),
    // Try JSON first, fall back to plain text for endpoints that return unquoted strings (e.g. Dolos /tx/submit)
    Effect.map((text): unknown => Either.getOrElse(Schema.decodeUnknownEither(Json)(text), () => text)),
    Effect.flatMap(Schema.decodeUnknown(schema))
  )
