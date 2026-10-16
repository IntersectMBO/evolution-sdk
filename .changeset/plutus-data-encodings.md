---
"@evolution-sdk/evolution": patch
---

Fix Plutus data encodings changing on re-encode. Empty arrays and maps now read their captured format before the empty fast paths, so an empty indefinite list or map — and an empty list with a wider length header — round-trips byte for byte, including an empty indefinite witness set. The `BoundedBytes` encoder now receives the captured format: it keeps the header width and replays a captured chunk layout only when the chunk sizes add up to the value's length and no chunk is over 64 bytes, so a stale layout is never carried into a datum. This keeps the script data hash and the transaction id stable for datums and redeemers in these forms.
