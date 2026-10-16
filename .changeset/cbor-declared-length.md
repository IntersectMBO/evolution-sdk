---
"@evolution-sdk/evolution": patch
---

The CBOR decoder no longer reads past the end of its input or trusts a declared array or map length that the input cannot hold. The five bytes `9a7fffffff` declare an array of 2^31 - 1 items, and `CBOR.fromCBORHex` and `Transaction.fromCBORHex` allocated for them until the process ran out of memory. The map form `ba7fffffff` ran for tens of seconds. The decoder also read a 4-byte length of 2^31 or more as a negative number, so the seven bytes `9f7afffffffbff` decoded the same item over and over until memory ran out. It now reads lengths unsigned. All of these now throw `CBORError` at once, as other truncated input already did. Well-formed CBOR decodes as before.
