# @evolution-sdk/dijkstra

Dijkstra (pv12) pre-fork transaction fields for Cardano: typed decode of the new and changed
`transaction_body` keys, plus the `script_require_guard` native-script variant.

> ⚠️ **PRE-FORK.** Grounded against the draft ledger CDDL only — no library ships Dijkstra, and
> the draft has already moved once (field 27 was added, and 26 was re-keyed from credential to
> reward account and gained a third, bare-`coin` arm). **Re-verify every shape before relying on
> it against a live chain.**

## What it reads

| key | field | shape |
|---|---|---|
| 14 | `guards` | replaces `required_signers`; a key-hash set **or** a credential oset |
| 23 | `sub_transactions` | nested transactions, as raw sub-tx CBOR |
| 24 | `required_top_level_guards` | `{ credential => plutus_data/nil }` |
| 25 | `direct_deposits` | `{ reward_account => coin }` |
| 26 | `account_balance_intervals` | `{ reward_account => account_balance_interval }` |
| 27 | `starting_account_balance_intervals` | same shape as 26 |

The byte layer already handles these: a decoder preserves an unrecognised body key verbatim, so
a Dijkstra transaction survives a Conway-era codec untouched. What was missing is a *reading* of
them, which is what a review surface and an analyzer need.

```ts
import { Body } from "@evolution-sdk/dijkstra"
import { Effect } from "effect"

const guards = Effect.runSync(Body.guards(bodyHex))        // Guards | undefined
const nested = Effect.runSync(Body.subTransactions(bodyHex)) // raw sub-tx CBOR
for (const sub of nested ?? []) {
  const { bodyHex: inner } = Effect.runSync(Body.splitTx(sub))
  // recurse typed decode into each nested body
}
```

## What it does not do

**It does not normalise.** `guards` reports which of its two forms a transaction used, because
that is a fact about the transaction. `account_balance_interval` keeps its three arms distinct —
the CDDL does not say what the bare `coin` form constrains, so collapsing it into an interval
would be inventing a meaning.

**It does not re-encode.** `sub_transactions` returns each nested transaction as the bytes it
arrived as: a nested body that is re-encoded is a different transaction id. Datums in
`required_top_level_guards` are raw for the same reason.

**It does not guess at a truncated body.** Reading past the end fails, rather than reporting
every field absent.

## `script_require_guard`

`NativeScript` carries the tag-6 native-script variant, build and decode:

```
script_require_guard = (6, credential)
credential           = [0, addr_keyhash] / [1, script_hash]
```

It lives here rather than in `@evolution-sdk/evolution`'s `NativeScripts` on purpose. That union
is a stable published type; this is a draft CDDL. Adding an arm to a settled union would make
every exhaustive `switch` on it a breaking change the day the draft shifts again. A consumer on a
Dijkstra chain reaches for this package, everyone else is unaffected, and a decoder that meets a
tag 6 it cannot name says so rather than guessing.

`decodeRequireGuard` returns `undefined` — not an error — for any other variant, because the
caller's own decoder owns those arms.
