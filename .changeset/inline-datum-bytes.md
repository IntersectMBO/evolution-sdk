---
"@evolution-sdk/evolution": patch
---

Decoding then re-encoding a transaction now keeps each inline datum's original bytes, so adding witnesses to a decoded transaction keeps its transaction id. Previously the encoder rewrote an inline datum whose layout differed from the default, for example turning a definite map `a10102` into `bf0102ff`.
