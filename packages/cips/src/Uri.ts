/**
 * CIP-13 — the Cardano URI scheme, plus the CIP-129 governance forms.
 *
 * `web+cardano:` URIs for payments, stake-pool delegation, addresses and DReps. A URI arrives
 * from outside the wallet, so every parse here is of untrusted input and reports what it cannot
 * read rather than guessing.
 *
 * @since 0.1.0
 */

import { Data, Effect } from "effect"

/** A malformed / unsupported `web+cardano:` URI. */
export class UriError extends Data.TaggedError("UriError")<{ readonly reason: string }> {}

/** CIP-13 payment ref: a bare address with an optional decimal-ADA amount. */
export interface PaymentUri {
  readonly authority: "payment"
  readonly address: string
  /** Decimal ADA (NOT lovelace), verbatim from the URI — e.g. `"1.5"`. */
  readonly amount?: string
}
/** CIP-13 stake-pool ref: one or more pools with optional relative proportions. */
export interface StakeUri {
  readonly authority: "stake"
  readonly pools: ReadonlyArray<StakePool>
}
export interface StakePool {
  /** 56-hex pool id or a 3–5 char pool ticker. */
  readonly pool: string
  /** Decimal proportion (relative weight); absent ⇒ defaults to 1 per spec. */
  readonly proportion?: string
}
/** CIP-134 address ref: any CIP-19 / CIP-105 address string. */
export interface AddressUri {
  readonly authority: "address"
  readonly address: string
}
/** CIP-162 DRep ref: a CIP-129 DRep id, or `always_abstain` / `always_no_confidence`. */
export interface DrepUri {
  readonly authority: "drep"
  readonly drepId: string
}

export type ParsedUri = PaymentUri | StakeUri | AddressUri | DrepUri

const SCHEME = "web+cardano:"

const fail = (reason: string) => Effect.fail(new UriError({ reason }))

/**
 * The CIP-13 `*digit [ "." *digit ]` grammar, minus the forms with no digit in them: it matches
 * `""` and `"."`, and neither is a number a consumer can read.
 */
const DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/

/** Parse a `web+cardano:` URI into its typed shape. */
export const parse = (uri: string): Effect.Effect<ParsedUri, UriError> => {
  if (!uri.startsWith(SCHEME)) return fail(`not a ${SCHEME} URI`)
  const rest = uri.slice(SCHEME.length)

  // authority forms start with `//`; the bare form is a payment address.
  if (!rest.startsWith("//")) return parsePayment(rest)
  const afterSlashes = rest.slice(2)

  if (afterSlashes.startsWith("addr/")) {
    const address = afterSlashes.slice("addr/".length)
    return address ? Effect.succeed({ authority: "address", address }) : fail("empty //addr/ address")
  }
  if (afterSlashes.startsWith("drep/")) {
    const drepId = afterSlashes.slice("drep/".length)
    return drepId ? Effect.succeed({ authority: "drep", drepId }) : fail("empty //drep/ id")
  }
  if (afterSlashes === "stake" || afterSlashes.startsWith("stake?")) {
    return parseStake(afterSlashes.slice("stake".length).replace(/^\?/, ""))
  }
  const authority = afterSlashes.split(/[/?]/, 1)[0]
  return fail(`unsupported authority "//${authority}" (standard CIP-13/134/162 only)`)
}

const parsePayment = (rest: string): Effect.Effect<ParsedUri, UriError> => {
  const q = rest.indexOf("?")
  const address = q === -1 ? rest : rest.slice(0, q)
  if (!address) return fail("empty payment address")
  if (q === -1) return Effect.succeed({ authority: "payment", address })
  const params = new URLSearchParams(rest.slice(q + 1))
  const amount = params.get("amount") ?? undefined
  if (amount !== undefined && !DECIMAL.test(amount)) return fail(`invalid amount "${amount}"`)
  return Effect.succeed({ authority: "payment", address, ...(amount !== undefined ? { amount } : {}) })
}

const parseStake = (query: string): Effect.Effect<StakeUri, UriError> => {
  if (!query) return fail("stake URI has no pools")
  const pools: Array<StakePool> = []
  const seen = new Set<string>()
  for (const tok of query.split("&")) {
    const eq = tok.indexOf("=")
    const pool = decodeURIComponent(eq === -1 ? tok : tok.slice(0, eq))
    const proportion = eq === -1 ? undefined : decodeURIComponent(tok.slice(eq + 1))
    if (!pool) return fail("empty pool id in stake URI")
    if (seen.has(pool)) return fail(`pool "${pool}" listed twice`)
    if (proportion !== undefined && !DECIMAL.test(proportion)) return fail(`invalid proportion "${proportion}"`)
    seen.add(pool)
    pools.push(proportion !== undefined ? { pool, proportion } : { pool })
  }
  return Effect.succeed({ authority: "stake", pools })
}

/** Build the canonical `web+cardano:` URI string for a parsed shape. */
export const build = (p: ParsedUri): string => {
  switch (p.authority) {
    case "payment":
      return SCHEME + p.address + (p.amount !== undefined ? `?amount=${p.amount}` : "")
    case "stake": {
      const q = p.pools.map((x) => (x.proportion !== undefined ? `${x.pool}=${x.proportion}` : x.pool)).join("&")
      return `${SCHEME}//stake?${q}`
    }
    case "address":
      return `${SCHEME}//addr/${p.address}`
    case "drep":
      return `${SCHEME}//drep/${p.drepId}`
  }
}

/** True if `uri` uses the `web+cardano:` scheme. */
export const isCardanoUri = (uri: string): boolean => uri.startsWith(SCHEME)
