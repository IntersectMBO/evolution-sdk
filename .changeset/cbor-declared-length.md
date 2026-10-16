---
"@evolution-sdk/evolution": patch
---

The CBOR decoder no longer reads past the end of its input or trusts a declared array or map length that the input cannot hold. The five bytes `9a7fffffff` declare an array of 2^31 - 1 items, and `CBOR.fromCBORHex` and `Transaction.fromCBORHex` allocated for them until the process ran out of memory. The map form `ba7fffffff` ran for tens of seconds. Both now throw `CBORError` at once, as other truncated input already did. Well-formed CBOR decodes as before.
