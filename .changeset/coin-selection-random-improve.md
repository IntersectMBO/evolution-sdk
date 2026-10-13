---
"@evolution-sdk/evolution": minor
---

`randomImproveSelection` is implemented. It was declared and never defined.

`CoinSelection` exported `randomImproveSelection` and `optimalSelection` as `export declare const`, so both were `undefined` at runtime, and `phases/Selection.ts` refused the matching algorithm names with "not yet implemented". A caller who set `coinSelectionAlgorithm: "random-improve"` got an error, and one who imported `randomImproveSelection` directly got `undefined`.

Random-improve is now a faithful port of CSL's `cip2_random_improve_by`: phase 1 selects at random until the target is covered, phase 2 swaps a chosen input for a remaining one when that moves the per-input contribution closer to twice the target without exceeding three times it. It is asset-aware — a target naming native assets covers each asset before the coin, then tops up for fees — and `largestFirstSelection` gains the same multi-asset path through the shared core.

Randomness defaults to `crypto.getRandomValues` and **throws rather than falling back** to a predictable PRNG when WebCrypto is absent, because an observer being unable to predict which UTxOs a wallet combines is the entire point of the strategy. `randomImproveSelectionWith({ seed })` exists for tests and examples; the deterministic strategies never construct an RNG at all, so largest-first keeps working where no WebCrypto exists.

`optimalSelection` and the `"optimal"` member of `CoinSelectionAlgorithm` are removed. Neither was implemented, and a declared export that is `undefined` at runtime fails later and less clearly than a name that does not resolve.
