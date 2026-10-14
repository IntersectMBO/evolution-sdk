---
"@evolution-sdk/evolution": patch
---

Fix the UPLC flat encoder encoding a Bool constant given as a plain JS boolean `false` as true. `ConstantValue` permits a JS boolean, but the Bool encoder read `.index` off the value, which a boolean does not have, so `con bool false` and `con bool true` produced identical flat bytes. The encoder now handles the boolean form directly; the decoded `{ index }` form encodes exactly as before.
