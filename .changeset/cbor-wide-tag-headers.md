---
"@evolution-sdk/evolution": patch
---

CBOR tags written with a 4- or 8-byte header now decode instead of failing with `Unsupported tag encoding`. `decodeTagAt` handles additional info 26 and 27 and records the header width in the captured format, so a value such as tag 258 written as `da00000102` round-trips byte for byte — including inside a transaction, where the node accepts that form.
