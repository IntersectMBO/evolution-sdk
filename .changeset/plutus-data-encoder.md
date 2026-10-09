---
"@evolution-sdk/evolution": minor
---

Plutus data now has its own encoder, so three kinds of value get the bytes the node writes under every option preset. Their bytes and datum hashes change:

- A constructor index above 127 writes its `[index, fields]` pair as a definite two-item array. `Data.constr(128n, [1n])` was `d8669f18809f01ffff` and is now `d8668218809f01ff`.
- The integer -2^64 is a plain negative integer, `3bffffffffffffffff`, where it was a negative bignum.
- A bignum whose bytes are longer than 64 is written in 64-byte chunks, as a long byte string already was.

`Data.toCBORBytes`, `Data.toCBORHex`, `Data.toDatumHash` and the encode side of `Data.FromCBORBytes` and `Data.FromCBORHex` use the new encoder, and so do redeemers, witness datums, inline datums, UPLC data constants and `Redeemers.toScriptDataHash`. All other data keeps its bytes under every preset. Decoding is unchanged. `Data.toCBORBytes` and `Data.toCBORHex` no longer validate their input with the schema first; a value that is not Plutus data now throws `DataError` instead of `ParseError`.

The CBOR encoder also writes -2^64 as `3bffffffffffffffff`. When a decoded transaction or witness set is written back, an integer decoded from a bignum tag keeps that tag, so a decoded -2^64 keeps its bytes in either form.
