---
"@evolution-sdk/evolution": patch
---

COSE `HeaderMap` now looks labels up by structural equality instead of JS `Map` reference equality. `header()` returns the value stored under an equal-but-distinct `Label` (it always returned `undefined` before), two `HeaderMap`s built from distinct but equal labels compare equal, and setting a header whose label is already present overwrites that entry instead of inserting a duplicate — so `EdDSA25519Key.build()` no longer leaves two entries at label 1.
