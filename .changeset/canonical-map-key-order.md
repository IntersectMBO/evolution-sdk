---
"@evolution-sdk/evolution": patch
---

Sort equal-length map keys bytewise in canonical CBOR encoding. Canonical mode and custom mode with `sortMapKeys: true` ordered map keys by encoded length only, so keys of the same length kept their insertion order. They now follow the length-first rule of RFC 8949 section 4.2.3, shorter keys first and equal lengths in bytewise order, which is the order the ledger and hardware wallets expect. The default encoding still keeps insertion order, and re-encoding with a captured format still reproduces the original bytes.
