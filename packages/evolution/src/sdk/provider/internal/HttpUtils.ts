import { Data, Effect, Schema } from "effect"
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
    // The signal aborts the in-flight request when the fiber is interrupted,
    // so callers wrapping these effects in Effect.timeout release the connection
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

const parseJson = (
  method: string,
  url: string,
  status: number,
  text: string
): Effect.Effect<unknown, HttpResponseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) =>
      new HttpResponseError({
        method,
        url,
        status,
        message: "failed to parse response as JSON",
        cause
      })
  })

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
    // Callers may override the content type
    headers: { "Content-Type": "application/json", ...headers },
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
    // Callers may override the content type
    headers: { "Content-Type": "application/cbor", ...headers },
    // BodyInit excludes views backed by SharedArrayBuffer, which Uint8Array's
    // default ArrayBufferLike admits; transaction bytes are never shared
    body: body as BodyInit
  }).pipe(
    Effect.flatMap((response) => readOkBody("POST", url, response)),
    // Try JSON first, fall back to plain text for endpoints that return unquoted strings (e.g. Dolos /tx/submit)
    Effect.map((text): unknown => {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }),
    Effect.flatMap(Schema.decodeUnknown(schema))
  )
