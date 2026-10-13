/**
 * User approval for sensitive connector operations.
 *
 * Some CIP-30 endpoints hand over privacy- or authority-sensitive data: the account extended
 * public key reveals every address a wallet has used and its whole history. Those must not be
 * served silently. This makes approval a first-class dependency, so a gated method *requires*
 * `ConsentTag` and it is type-level impossible to call one without the app's implementation.
 *
 * The library owns no prompt UI. An app wires its dialog in through `consentFrom`; tests use
 * `allowAll`.
 *
 * ```ts
 * const layer = Consent.consentFrom((req) => showDialog(req))
 * connector.getAccountPublicKey().pipe(Effect.provide(layer))
 * ```
 *
 * @since 0.1.0
 */
import { Context, Data, Effect, Layer } from "effect"

/**
 * A sensitive request awaiting user approval.
 *
 * @since 0.1.0
 * @category model
 */
export interface ConsentRequest {
  /** The connector method being requested, e.g. `"getAccountPublicKey"`. */
  readonly method: string
  /** Human-readable description of what would be shared, for the prompt. */
  readonly detail?: string
}

/**
 * The user, or the app on their behalf, declined a sensitive request.
 *
 * @since 0.1.0
 * @category errors
 */
export class ConsentDenied extends Data.TaggedError("ConsentDenied")<{
  readonly method: string
  readonly reason?: string
}> {}

/**
 * @since 0.1.0
 * @category model
 */
export interface Consent {
  /** Ask for approval; succeed if granted, fail with `ConsentDenied` if refused. */
  readonly request: (req: ConsentRequest) => Effect.Effect<void, ConsentDenied>
}

/**
 * @since 0.1.0
 * @category context
 */
export class ConsentTag extends Context.Tag("@evolution-sdk/cip30/Consent")<ConsentTag, Consent>() {}

/**
 * Grants every request. **Tests and examples only** — a real app must prompt.
 *
 * @since 0.1.0
 * @category layers
 */
export const allowAll: Layer.Layer<ConsentTag> = Layer.succeed(ConsentTag, { request: () => Effect.void })

/**
 * Denies every request: the safe default before an app wires a real prompt.
 *
 * @since 0.1.0
 * @category layers
 */
export const denyAll: Layer.Layer<ConsentTag> = Layer.succeed(ConsentTag, {
  request: (req) => Effect.fail(new ConsentDenied({ method: req.method, reason: "no consent handler configured" }))
})

/**
 * Build the seam from an app approval callback: resolve `true` to grant, `false` or throw to
 * deny. This is where a wallet plugs in its dialog.
 *
 * @since 0.1.0
 * @category constructors
 */
export const consentFrom = (
  approve: (req: ConsentRequest) => boolean | Promise<boolean>
): Layer.Layer<ConsentTag> =>
  Layer.succeed(ConsentTag, {
    request: (req) =>
      Effect.tryPromise({
        try: async () => {
          if (!(await approve(req))) throw new Error("denied")
        },
        catch: () => new ConsentDenied({ method: req.method })
      })
  })
