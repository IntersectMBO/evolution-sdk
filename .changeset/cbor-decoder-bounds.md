---
"@evolution-sdk/evolution": patch
---

The CBOR decoder now rejects truncated and length-lying input with a `CBORError` instead of reading past the end of the input or allocating for a declared length. `CBOR.fromCBORHex("9a7fffffff")` — an array header declaring 2^31 - 1 items over five bytes — previously aborted the Node process with a heap out-of-memory that `try`/`catch` cannot stop; it now throws immediately. Three checks, all of which well-formed CBOR never hits:

- Decoding an item at or past the end of the input throws, instead of `data[offset]` reading `undefined` and decoding as the integer 0.
- A definite array or map whose declared length needs more bytes than remain throws before any allocation or looping.
- A 4-byte length is read unsigned, so a length with the top bit set (e.g. `0xffffffff`) no longer reads as a negative number.
