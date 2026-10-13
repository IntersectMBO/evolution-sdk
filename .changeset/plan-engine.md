---
"@evolution-sdk/plan": minor
---

New package: wallet-side transaction planning — a plan says what a transaction should do, and the engine converges fee, change and collateral until it balances.

`Plan.buildUnsigned` takes a plan and returns the body bytes, the inputs it chose, the change it emitted and a `FeeBreakdown`. It reaches no network and holds no key, and it encodes through `@evolution-sdk/evolution` directly rather than through a seam of its own.

`ExUnits` is where a redeemer's execution units come from, as a swappable service with three backends: supplied by the caller (cached or measured), taken from a preset table with a margin (no network, no VM — the only option where WASM cannot run), or evaluated by a provider. Declared ex-units are not in the script context, so a build → evaluate → rebuild loop is stable; the only question is what backs the numbers.

⚠️ Outputs are built with `encodingFormat: "babbage"`. Conway accepts both the Shelley array and the Babbage map, a node takes either, and they are **different bytes** — a different transaction id, a different min-ada, and a different body for a hardware wallet to reconstruct. The engine says which one it means rather than inheriting a default that varies with whether an inline datum happens to be present.
