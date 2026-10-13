import { Effect } from "effect"

/**
 * A client-side request budget, shared by every provider that talks to the same host.
 *
 * A provider that fans out — a gap-limit address scan, a history backfill, a per-asset
 * sweep — spends a published allowance in a couple of seconds, and the endpoint answers
 * 429, or in Koios's case 403 to *everything* once a per-address budget is gone. Retrying
 * after the fact is the wrong shape: the refusal has already been earned, and every call
 * site has to reinvent the backoff. Pacing before the call means the limit is never
 * exceeded.
 *
 * The budget is keyed by **host**, not by provider instance: several providers are
 * routinely built against one endpoint, and a per-instance limiter would let each of them
 * spend the whole allowance. It lives at module scope for the same reason.
 *
 * Nothing is paced until a host is given a budget with {@link configure}; an unconfigured
 * host is only counted, so {@link setObserver} still sees the traffic.
 *
 * @since 2.2.0
 * @category model
 */
export interface HostBudget {
  /** Requests allowed inside one window. */
  readonly limit: number
  /** Window length in milliseconds. */
  readonly windowMs: number
}

/**
 * How far back `inWindow` counts for a host with no configured budget. Counting is the
 * part that still matters without pacing: a refusal that names no volume cannot be told
 * apart from the endpoint shedding load.
 *
 * @since 2.2.0
 * @category constants
 */
export const OBSERVATION_WINDOW_MS = 10_000

/**
 * The budget key for a url: one allowance per origin.
 *
 * Derived without `new URL` so a malformed value degrades to itself rather than throwing
 * on the request path. Every caller must agree on this function — one keying its requests
 * differently would spend an allowance of its own.
 *
 * @since 2.2.0
 * @category utils
 */
export const hostKey = (url: string): string => /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? url

/**
 * The path a request went to, query and fragment dropped — what a tally groups by.
 *
 * @since 2.2.0
 * @category utils
 */
export const requestPath = (url: string): string => {
  const rest = url.slice(hostKey(url).length)
  const end = rest.search(/[?#]/)
  const path = end === -1 ? rest : rest.slice(0, end)
  return path.length > 0 ? path : "/"
}

/**
 * A host's issued requests and the allowance they are measured against.
 *
 * @since 2.2.0
 * @category model
 */
export interface BudgetWindow {
  /** Issue times of requests still inside the window, oldest first. */
  readonly recent: ReadonlyArray<number>
  readonly limit: number
  readonly windowMs: number
}

/**
 * How long to wait before issuing the next request against this window, in milliseconds.
 *
 * Pure, so the pacing rule is testable without timers: drop the issue times that have aged
 * out; if there is room, go now; otherwise wait until the oldest one ages out.
 *
 * @since 2.2.0
 * @category utils
 */
export const throttleDelayMs = (window: BudgetWindow, now: number): number => {
  const cutoff = now - window.windowMs
  const live = window.recent.filter((at) => at > cutoff)
  if (live.length < window.limit) return 0
  const oldest = live[0]
  if (oldest === undefined) return 0
  return Math.max(0, oldest + window.windowMs - now)
}

/** Drop issue times that have aged out, and record `now`. */
const recordIssue = (recent: ReadonlyArray<number>, now: number, windowMs: number): ReadonlyArray<number> => [
  ...recent.filter((at) => at > now - windowMs),
  now
]

interface HostState {
  recent: ReadonlyArray<number>
  /** Serialises acquisition so concurrent callers cannot both see the same free slot. */
  gate: Promise<void>
}

const states = new Map<string, HostState>()
const budgets = new Map<string, HostBudget>()

const stateFor = (host: string): HostState => {
  const existing = states.get(host)
  if (existing !== undefined) return existing
  const created: HostState = { recent: [], gate: Promise.resolve() }
  states.set(host, created)
  return created
}

/**
 * Give a host an allowance, or remove it with `null`. The key is an origin — what
 * {@link hostKey} returns for that host's urls.
 *
 * @example
 * ```typescript
 * import * as RequestBudget from "@evolution-sdk/evolution/sdk/provider/RequestBudget"
 *
 * RequestBudget.configure("https://api.koios.rest", { limit: 90, windowMs: 10_000 })
 * ```
 *
 * @since 2.2.0
 * @category combinators
 */
export const configure = (host: string, budget: HostBudget | null): void => {
  const key = hostKey(host)
  if (budget === null) budgets.delete(key)
  else budgets.set(key, budget)
}

/**
 * The allowance in force for a host, or `undefined` when it has none and is only counted.
 *
 * @since 2.2.0
 * @category getters
 */
export const budgetFor = (host: string): HostBudget | undefined => budgets.get(hostKey(host))

/**
 * Requests issued against a host inside the current window.
 *
 * Reads the pacer's own ledger rather than a second counter, so what a report says was
 * spent is what the pacer priced.
 *
 * @since 2.2.0
 * @category getters
 */
export const windowCount = (host: string, now: number = Date.now()): number => {
  const key = hostKey(host)
  const state = states.get(key)
  if (state === undefined) return 0
  const windowMs = budgets.get(key)?.windowMs ?? OBSERVATION_WINDOW_MS
  const cutoff = now - windowMs
  return state.recent.filter((at) => at > cutoff).length
}

/**
 * Wait until issuing a request to `url` stays inside its host's allowance, then record it.
 * Resolves with how long the request was held back, which is what a report needs to
 * separate our own pacing from the endpoint's latency.
 *
 * A host with no allowance is recorded and issued immediately.
 *
 * @since 2.2.0
 * @category combinators
 */
export const acquire = (url: string): Effect.Effect<number> =>
  Effect.promise(() => {
    const key = hostKey(url)
    const state = stateFor(key)
    const budget = budgets.get(key)

    if (budget === undefined) {
      state.recent = recordIssue(state.recent, Date.now(), OBSERVATION_WINDOW_MS)
      return Promise.resolve(0)
    }

    const startedWaiting = Date.now()
    const next = state.gate.then(async () => {
      for (;;) {
        const now = Date.now()
        const delay = throttleDelayMs({ recent: state.recent, limit: budget.limit, windowMs: budget.windowMs }, now)
        if (delay === 0) {
          state.recent = recordIssue(state.recent, now, budget.windowMs)
          return now - startedWaiting
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    })
    // Keep the chain alive even if a waiter is interrupted.
    state.gate = next.then(
      () => undefined,
      () => undefined
    )
    return next
  })

/**
 * One request the pacer let through, reported once its outcome is known.
 *
 * The pacer is the only place every provider read passes through, so it is the only place
 * that can say how much was actually spent — which is what a refusal needs to be
 * attributable. Without it a 429 or a 403 names no volume at all.
 *
 * @since 2.2.0
 * @category model
 */
export interface RequestReport {
  /** The budget key: the backend's origin. */
  readonly host: string
  /** The path the request went to, query dropped. */
  readonly path: string
  readonly method: string
  /** HTTP status, or 0 when no response arrived at all. */
  readonly status: number
  /** How long the pacer held this request back before issuing it. */
  readonly waitedMs: number
  /** Round-trip time once issued. */
  readonly ms: number
  /** Requests issued against `host` inside the current window, this one included. */
  readonly inWindow: number
  /**
   * The response body, when the response was a refusal.
   *
   * The status alone does not identify a refusal: Koios answers 429 both for one
   * credential over its own window (`Exceeded Burst Limit, count was N`) and for an
   * instance shedding load by source IP, and the two are told apart by this text. Absent
   * means the body could not be read, which is not the same as an empty one.
   */
  readonly refusalBody?: string
}

/**
 * Observer contract: it MUST NOT throw. It runs on the request path, so a throw fails the
 * request that reported to it — deliberately not caught here, because a library with no
 * logger could only swallow it, and a silently dropped observer is the failure this seam
 * exists to end.
 *
 * @since 2.2.0
 * @category model
 */
export type RequestObserver = (report: RequestReport) => void

let observer: RequestObserver | null = null

/**
 * Install, or clear with `null`, the process-wide request observer.
 *
 * @since 2.2.0
 * @category combinators
 */
export const setObserver = (next: RequestObserver | null): void => {
  observer = next
}

/**
 * Report a request to the installed observer. A no-op when there is none.
 *
 * @since 2.2.0
 * @category combinators
 */
export const report = (request: RequestReport): void => {
  observer?.(request)
}

/**
 * Forget every host's issue ledger and allowance. The observer is left alone.
 *
 * @since 2.2.0
 * @category combinators
 */
export const reset = (): void => {
  states.clear()
  budgets.clear()
}
