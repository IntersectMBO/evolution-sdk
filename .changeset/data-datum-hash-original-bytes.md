---
"@evolution-sdk/evolution": patch
---

`Data.toDatumHash` now hashes a decoded datum over the bytes it was decoded from — the hash the ledger computes — instead of over a re-encode of the value. `Data.fromCBORBytes` and `Data.fromCBORHex` remember a copy of the source bytes for object datums decoded with the default codec options (a WeakMap, mirroring Transaction's format cache), and `toDatumHash` replays them under the default options. A datum whose source bytes differ from the module's own encoding — a definite-length list, an indefinite-length map, a non-minimal integer or length header — previously hashed to a value the node never computed. Bare integer datums are bigints, which cannot be WeakMap keys, and still hash their re-encode.
