---
"@evolution-sdk/evolution": minor
---

Two ways a transaction's id could change out from under a signer, both closed.

**A bare input set stays bare.** Conway writes a transaction's input set as `#6.258([...])`; Babbage wrote a bare array and the ledger still accepts it. `TransactionBody` decoded both and encoded only the tagged form, so a body that arrived bare came back three bytes longer with a different transaction id — and in `addVKeyWitnesses` the signature was already attached to it. A wallet co-signing someone else's transaction does not get to choose the form it is handed. The format-preserving encoder now replays a `#6.258` wrapper exactly as it arrived: where the captured format says there was no tag at that position and the value carries one, the set is emitted bare. Scoped to tag 258 — the one tag whose presence is a matter of form rather than of meaning — so any other disagreement between a value and a format still resolves in favour of the value.

**An unmodelled body key is refused instead of dropped.** The body's fields are read by key, so a key the decoder does not read was absent from the result and missing from the re-encode: measured, a body with one extra key went in at 1213 bytes and came out at 1209, a different transaction id, with nothing raised. This schema models the whole of Conway's `transaction_body` (0–5, 7–9, 11, 13–22), so an unmodelled key is either a pre-Conway field it cannot represent or a field from a newer era — and decoding now fails, naming the key.

⚠️ Preserving such a key would not have been better: it would let a wallet sign a field it could not display, which is the thing a review step exists to prevent. Refusing is the forward-compatible behaviour that is also the safe one.
