/**
 * Dijkstra (pv12) — typed decode of the new and changed `transaction_body` fields.
 *
 * The byte layer already round-trips these: a decoder preserves an unrecognised body key
 * verbatim, so a Dijkstra transaction survives a Conway-era codec untouched. What is missing is
 * a *reading* of them, which is what a review surface and an analyzer need.
 *
 * ```
 *  14  guards                              replaces required_signers; key-hash set OR credential oset
 *  23  sub_transactions                    nested txs, returned as raw sub-tx CBOR
 *  24  required_top_level_guards           { credential => plutus_data/nil }
 *  25  direct_deposits                     { reward_account => coin }
 *  26  account_balance_intervals           { reward_account => account_balance_interval }
 *  27  starting_account_balance_intervals  same shape as 26
 * ```
 *
 * ⚠️⚠️ **PRE-FORK.** Grounded against the draft ledger CDDL only — no library ships Dijkstra.
 * Re-verify every shape before relying on it against a live chain. The CDDL has already moved
 * once: field 27 was added, and 26 was re-keyed from credential to reward_account and gained a
 * third, bare-`coin` arm.
 *
 * @since 0.1.0
 */

import { Data, Effect } from "effect"

import { arrayHead, field, isNull, mapHead, readBytes, readHead, readUint, skip } from "./internal/Cbor.js"
import { bytesToHex, hexToBytes } from "./internal/Hex.js"

/** @since 0.1.0 */
export class DijkstraError extends Data.TaggedError("DijkstraError")<{ readonly reason: string }> {}

/** A stake/DRep/committee credential `[0, key_hash] | [1, script_hash]`. @since 0.1.0 */
export interface Credential {
  readonly hashHex: string
  readonly isScript: boolean
}

/**
 * Body field 14. The two forms are kept distinct rather than normalised: the key-hash set is the
 * back-compatible `required_signers` shape, and which one a transaction used is a fact about it.
 *
 * @since 0.1.0
 */
export type Guards =
  | { readonly form: "keyhash"; readonly keyHashes: ReadonlyArray<string> }
  | { readonly form: "credential"; readonly credentials: ReadonlyArray<Credential> }

/** @since 0.1.0 */
export interface DirectDeposit {
  readonly rewardAccountHex: string
  readonly coin: bigint
}

/**
 * `account_balance_interval` — three arms in the CDDL, kept distinct rather than collapsed: a
 * pair with at least one bound present, or a bare `coin`.
 *
 * ⚠️ The CDDL does not say what the bare form constrains, so it is reported as itself rather
 * than guessed into an interval.
 *
 * @since 0.1.0
 */
export type AccountBalanceBound =
  | {
      readonly form: "interval"
      /** inclusive lower bound (absent means unbounded below) */
      readonly lower?: bigint
      /** exclusive upper bound (absent means unbounded above) */
      readonly upper?: bigint
    }
  | { readonly form: "coin"; readonly coin: bigint }

/** @since 0.1.0 */
export interface AccountBalanceInterval {
  /** `reward_account`: the 29-byte header+hash form, NOT a credential. */
  readonly rewardAccountHex: string
  readonly bound: AccountBalanceBound
}

/** @since 0.1.0 */
export interface RequiredGuard {
  readonly credential: Credential
  /** `plutus_data` argument as CBOR hex, absent for `nil`. */
  readonly datumHex?: string
}

const KEY = {
  guards: 14,
  subTransactions: 23,
  requiredTopLevelGuards: 24,
  directDeposits: 25,
  accountBalanceIntervals: 26,
  startingAccountBalanceIntervals: 27
} as const

const hex = (b: Uint8Array, start: number, end: number): string => bytesToHex(b.subarray(start, end))

const readCredential = (b: Uint8Array, o: number): [Credential, number] => {
  const [, p0] = arrayHead(b, o)
  const [tag, p1] = readUint(b, p0)
  const [h, p2] = readBytes(b, p1)
  return [{ hashHex: bytesToHex(h), isScript: tag === 1n }, p2]
}

const wrap = <A>(reason: string, f: () => A): Effect.Effect<A, DijkstraError> =>
  Effect.try({
    try: f,
    catch: (e) => new DijkstraError({ reason: `${reason}: ${e instanceof Error ? e.message : String(e)}` })
  })

/**
 * Body field 14 `guards` — a key-hash set (back-compatible with `required_signers`) or a
 * credential oset.
 *
 * @since 0.1.0
 */
export const guards = (bodyHex: string): Effect.Effect<Guards | undefined, DijkstraError> =>
  wrap("guards", () => {
    const b = hexToBytes(bodyHex)
    const f = field(b, KEY.guards)
    if (!f) return undefined
    const [count, p0] = arrayHead(b, f.start)
    // The element type is what distinguishes the two forms: a bytestring is a key hash, an array
    // is a credential. An empty set is reported as the back-compatible form.
    if (count === 0) return { form: "keyhash", keyHashes: [] }
    if (readHead(b, p0).major === 2) {
      const keyHashes: Array<string> = []
      let p = p0
      for (let i = 0; i < count; i++) {
        const [h, np] = readBytes(b, p)
        keyHashes.push(bytesToHex(h))
        p = np
      }
      return { form: "keyhash", keyHashes }
    }
    const credentials: Array<Credential> = []
    let p = p0
    for (let i = 0; i < count; i++) {
      const [c, np] = readCredential(b, p)
      credentials.push(c)
      p = np
    }
    return { form: "credential", credentials }
  })

/**
 * Body field 25 `direct_deposits` — `{ reward_account => coin }`.
 *
 * @since 0.1.0
 */
export const directDeposits = (
  bodyHex: string
): Effect.Effect<ReadonlyArray<DirectDeposit> | undefined, DijkstraError> =>
  wrap("directDeposits", () => {
    const b = hexToBytes(bodyHex)
    const f = field(b, KEY.directDeposits)
    if (!f) return undefined
    const [count, p0] = mapHead(b, f.start)
    const out: Array<DirectDeposit> = []
    let p = p0
    for (let i = 0; i < count; i++) {
      const [acct, p1] = readBytes(b, p)
      const [coin, p2] = readUint(b, p1)
      out.push({ rewardAccountHex: bytesToHex(acct), coin })
      p = p2
    }
    return out
  })

// account_balance_interval = [coin, coin/nil] / [coin/nil, coin] / coin
const readBalanceBound = (b: Uint8Array, o: number): [AccountBalanceBound, number] => {
  if (readHead(b, o).major === 0) {
    const [coin, p] = readUint(b, o)
    return [{ form: "coin", coin }, p]
  }
  const [n, p0] = arrayHead(b, o)
  if (n !== 2) throw new Error(`account_balance_interval: expected a 2-element array, got ${n}`)
  let q = p0
  let lower: bigint | undefined
  if (isNull(b, q)) q += 1
  else {
    const [v, np] = readUint(b, q)
    lower = v
    q = np
  }
  let upper: bigint | undefined
  if (isNull(b, q)) q += 1
  else {
    const [v, np] = readUint(b, q)
    upper = v
    q = np
  }
  // Both arms of the pair name one bound as non-nil; a [nil, nil] constrains nothing.
  if (lower === undefined && upper === undefined) throw new Error("account_balance_interval: both bounds are nil")
  return [{ form: "interval", ...(lower !== undefined ? { lower } : {}), ...(upper !== undefined ? { upper } : {}) }, q]
}

const balanceIntervalMap = (bodyHex: string, key: number): ReadonlyArray<AccountBalanceInterval> | undefined => {
  const b = hexToBytes(bodyHex)
  const f = field(b, key)
  if (!f) return undefined
  const [count, p0] = mapHead(b, f.start)
  const out: Array<AccountBalanceInterval> = []
  let p = p0
  for (let i = 0; i < count; i++) {
    const [acct, p1] = readBytes(b, p)
    const [bound, p2] = readBalanceBound(b, p1)
    out.push({ rewardAccountHex: bytesToHex(acct), bound })
    p = p2
  }
  return out
}

/**
 * Body field 26 `account_balance_intervals` — `{ reward_account => account_balance_interval }`.
 *
 * @since 0.1.0
 */
export const accountBalanceIntervals = (
  bodyHex: string
): Effect.Effect<ReadonlyArray<AccountBalanceInterval> | undefined, DijkstraError> =>
  wrap("accountBalanceIntervals", () => balanceIntervalMap(bodyHex, KEY.accountBalanceIntervals))

/**
 * Body field 27 `starting_account_balance_intervals` — the same shape as 26.
 *
 * @since 0.1.0
 */
export const startingAccountBalanceIntervals = (
  bodyHex: string
): Effect.Effect<ReadonlyArray<AccountBalanceInterval> | undefined, DijkstraError> =>
  wrap("startingAccountBalanceIntervals", () => balanceIntervalMap(bodyHex, KEY.startingAccountBalanceIntervals))

/**
 * Body field 24 `required_top_level_guards` — `{ credential => plutus_data/nil }`.
 *
 * ⚠️ The datum is reported as the **bytes it arrived as**, not a decoded tree: a datum that
 * re-encodes differently hashes differently.
 *
 * @since 0.1.0
 */
export const requiredTopLevelGuards = (
  bodyHex: string
): Effect.Effect<ReadonlyArray<RequiredGuard> | undefined, DijkstraError> =>
  wrap("requiredTopLevelGuards", () => {
    const b = hexToBytes(bodyHex)
    const f = field(b, KEY.requiredTopLevelGuards)
    if (!f) return undefined
    const [count, p0] = mapHead(b, f.start)
    const out: Array<RequiredGuard> = []
    let p = p0
    for (let i = 0; i < count; i++) {
      const [credential, p1] = readCredential(b, p)
      const datumNull = isNull(b, p1)
      const end = datumNull ? p1 + 1 : skip(b, p1)
      out.push({ credential, ...(datumNull ? {} : { datumHex: hex(b, p1, end) }) })
      p = end
    }
    return out
  })

/**
 * Body field 23 `sub_transactions` — the nested transactions, each as **raw CBOR**.
 *
 * ⚠️ Deliberately not decoded further. A nested body that is re-encoded is a different
 * transaction id, so a caller gets the exact bytes and recurses with {@link splitTx}.
 *
 * @since 0.1.0
 */
export const subTransactions = (bodyHex: string): Effect.Effect<ReadonlyArray<string> | undefined, DijkstraError> =>
  wrap("subTransactions", () => {
    const b = hexToBytes(bodyHex)
    const f = field(b, KEY.subTransactions)
    if (!f) return undefined
    const [count, p0] = arrayHead(b, f.start)
    const out: Array<string> = []
    let p = p0
    for (let i = 0; i < count; i++) {
      const end = skip(b, p)
      out.push(hex(b, p, end))
      p = end
    }
    return out
  })

/** The Dijkstra transaction shape `[body, wits, aux/nil]` split into its parts. @since 0.1.0 */
export interface Tx3 {
  readonly bodyHex: string
  readonly witnessHex: string
  /** `auxiliary_data` CBOR, absent when `nil`. */
  readonly auxHex?: string
}

/**
 * Frame a Dijkstra 3-tuple transaction `[body, wits, aux/nil]` — the pv12 canonical form, where
 * `is_valid` is dropped.
 *
 * ⚠️ Opt-in: the 4-tuple `transaction_mempool` form still submits post-fork.
 *
 * @since 0.1.0
 */
export const assemble3Tuple = (bodyHex: string, witnessHex: string, auxHex?: string): string =>
  `83${bodyHex}${witnessHex}${auxHex ?? "f6"}`

/**
 * Split a Dijkstra 3-tuple transaction (or one `sub_transactions` entry) into its parts, so a
 * caller can recurse typed decode into each nested body.
 *
 * @since 0.1.0
 */
export const splitTx = (txHex: string): Effect.Effect<Tx3, DijkstraError> =>
  wrap("splitTx", () => {
    const b = hexToBytes(txHex)
    const [count, p0] = arrayHead(b, 0)
    if (count !== 3) {
      throw new Error(
        `expected a 3-tuple [body,wits,aux], got ${count} elements — a 4-tuple is either the back-compat mempool form [body,wits,true,aux] or a block_transaction [body,wits,aux,is_valid]`
      )
    }
    const bodyEnd = skip(b, p0)
    const witEnd = skip(b, bodyEnd)
    const auxIsNull = isNull(b, witEnd)
    const auxEnd = auxIsNull ? witEnd + 1 : skip(b, witEnd)
    return {
      bodyHex: hex(b, p0, bodyEnd),
      witnessHex: hex(b, bodyEnd, witEnd),
      ...(auxIsNull ? {} : { auxHex: hex(b, witEnd, auxEnd) })
    }
  })
