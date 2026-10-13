---
"@evolution-sdk/evolution": patch
---

`getChainParameters` works against a live Koios, and a Koios failure says what went wrong.

Three defects, found by driving the provider against preprod rather than against a stubbed `fetch`:

**The integer fields arrive as strings.** `HttpUtils` parses every response with a reviver that hands each number to the schema as the exact text the server wrote, so a `uint64` amount survives at any size. The chain-parameter mapping read them with a helper that insisted on `typeof value === "number"` — so it rejected every populated document and accepted only hand-built fixtures that never went through the reviver. `committeeMinSize` is `"3"` on the wire and `3` in a test, and the test was the only thing that ever matched the code. The mapping is now covered by a test driven through `HttpUtils` against a **real preprod `/cli_protocol_params` document**, so the wire shape is what the assertion sees.

**The rationals arrive in exponent notation, and reading them back through `toFixed` re-introduced the error exactness exists to remove.** Koios serves `priceMemory` as `5.77e-2` and `monetaryExpansion` as `3.0e-3`; `(7.21e-5).toFixed(20)` is `"0.00000007210000000000"`-adjacent only in the lucky cases — for `1e-7` it is `"0.00000009999999999999"`, a twenty-digit fraction whose denominator (5e19) does not even fit a `uint64`. The decode failed outright on the document the endpoint actually serves. There is now one implementation of decimal → exact rational, `NonnegativeInterval.fromDecimal`, which expands the exponent from the text; this module delegates to it.

**A failure named the operation and dropped the reason.** `Koios getChainParameters failed` was the whole message, with the cause only in a field that re-wrapping layers discard. The cause is now in the message too, because that is what survives being wrapped.
