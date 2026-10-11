# @evolution-sdk/review

Review-before-sign for Cardano: a **span-preserving** view of a transaction, what it does, and
whether the ledger would refuse it.

A wallet showing a user what they are about to sign, a co-signer deciding whether to add a
witness, and a hardware sign-request builder all need the same thing: the transaction exactly as
it arrived, decoded without anything being quietly dropped.

## Why this is not a schema decoder

Decoding a transaction into a value tree and re-encoding it loses two things that a review
surface cannot do without.

**The exact bytes.** `Inspect.txBodyFromTx` returns the body's original span, not a re-encode. A
span that differs by one byte is a different transaction id, so "close enough" does not exist
here. The package's own test pins this against a real preprod transaction's published id:
`blake2b-256` over the returned slice must reproduce it.

**What the decoder did not recognise.** `Inspect.txBody` reports `unknownKeys` — body-map keys it
does not model — and `inputsSetTagged`, whether the input set arrived `#6.258` or bare. A decoder
built to accept valid known shapes silently discards both, and a body that shows a reviewer one
thing and a downstream decoder another is exactly what review-before-sign exists to prevent.

For the same reason a duplicate body key is **rejected** rather than resolved last-wins.

## Modules

| module | what it answers |
|---|---|
| `Inspect` | the whole body as a typed view, plus the exact spans of body / witness set / auxiliary data |
| `Analyze` | what the transaction *does* — certificates, mint, governance, scripts, redeemers — over the swappable `Decode` service |
| `Phase1` | would the ledger refuse these bytes, as far as provider data can prove it |
| `Decode` | the decode seam and its Evolution-backed implementation |

```ts
import { Inspect, Analyze, Decode } from "@evolution-sdk/review"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const bodyHex = yield* Inspect.txBodyFromTx(txCbor)
  const { body, taggedSets } = yield* Inspect.txBody(bodyHex)
  if (body.unknownKeys.length > 0) {
    // This transaction carries something this view cannot explain. Say so; do not sign blind.
  }
  const certs = yield* Analyze.certificates(bodyHex)
  return { body, taggedSets, certs }
}).pipe(Effect.provide(Decode.layer))
```

## Scope

`Phase1` is phase 1 — the deterministic, pre-script part of ledger validation — as far as
provider data can prove it. It is not a node: it does not run Plutus, does not check witnesses or
script-data hashes, and does not know the mempool.

`Analyze`'s view is bounded by the typed decode: `signers` is the certificate-, voter- and
native-script-derived set, not the complete one.

Two shapes have no Evolution equivalent and the decoder **throws** rather than inventing one: a
`require_guard` native script (Dijkstra, pre-fork) and any certificate the schema rejects. A
backend that answered `[]` would show a script transaction as carrying no scripts.
