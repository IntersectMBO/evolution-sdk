---
"@evolution-sdk/evolution": minor
---

A provider that bounds its request body publishes the batches `getTxsAt` can serve.

`getTxsAt` refuses an `offset` across a split body, and that is the only correct answer: the global rows `[offset, offset + limit)` over several address streams are knowable only by reading the first `offset + limit` of every one of them. But a caller that pages has to batch under the same budget, and the budget is the implementation's arithmetic — a count restated beside the caller is a count that drifts, because what fits at one address length splits at another.

`ProviderEffect.splitAddressesForTxsAt` is that arithmetic, published. Optional, like the rest of the history tier, and **absent means unbounded**: the whole list is one batch, which is what a backend with no body limit should say. It is pure, because it is arithmetic over the serialized length and reaches nothing. Koios implements it with the chunker `getTxsAt` itself uses, so the batches it hands back are exactly the ones that go out as one request each — asserted both ways, including that the next address over the line is still refused.

This is not hypothetical: a consuming wallet sized its batches from the 5120-byte limit Koios enforces rather than from the 4096-byte budget this client holds itself to, and every history window it walked was refused in a few milliseconds, before a request went out, with the stored list left standing.
