---
"@evolution-sdk/review": minor
---

New package: a span-preserving review of a transaction — what it does, and whether the ledger would refuse it.

A wallet showing a user what they are about to sign, a co-signer deciding whether to add a witness, and a hardware sign-request builder all need the transaction exactly as it arrived, decoded without anything quietly dropped. Decoding into a value tree and re-encoding loses two things a review surface cannot do without:

- **The exact bytes.** `Inspect.txBodyFromTx` returns the body's original span rather than a re-encode. A span that differs by one byte is a different transaction id, so "close enough" does not exist here; the package pins this against a real preprod transaction's published id.
- **What the decoder did not recognise.** `Inspect.txBody` reports `unknownKeys` — body-map keys it does not model — and `inputsSetTagged`, whether the input set arrived `#6.258` or bare. Both are silently discarded by a decoder built to accept valid known shapes, and a body that shows a reviewer one thing and a downstream decoder another is what review-before-sign exists to prevent. A duplicate body key is rejected rather than resolved last-wins.

`Analyze` says what the transaction does (certificates, mint, governance, scripts, redeemers) over a swappable `Decode` service; `Phase1` says whether the ledger would refuse the bytes, as far as provider data can prove it.

`OriginalBytes` and this package are complements: `OriginalBytes` answers "write back exactly what I read" for a value you hold, `Inspect` answers "show me exactly what I am about to sign", including the parts the schema does not model.
