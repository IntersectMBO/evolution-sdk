---
"@evolution-sdk/evolution": patch
---

CBOR decoding now bounds a definite array's or map's declared length against the bytes that remain before allocating or looping, mirroring the existing byte string guard. Before, a tiny input declaring billions of elements (for example `d8799a7fffffff`, 7 bytes) drove a fatal, uncatchable heap OOM, because reads past the end of the buffer decode as `0n` instead of throwing; it now throws a catchable `CBORError` naming the declared length and the remaining bytes.
