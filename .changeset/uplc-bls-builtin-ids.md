---
"@evolution-sdk/evolution": patch
---

Fix the Flat IDs of six BLS12-381 builtins in UPLC. Plutus assigns `bls12_381_G1_compress`, `bls12_381_G1_uncompress` and `bls12_381_G1_hashToGroup` to IDs 58, 59 and 60, and the G2 variants to 65, 66 and 67. `BuiltinFunctions` had `hashToGroup` first, so decoding a script reported the wrong builtin name, and a term built with `builtinTerm("bls12_381_G1_compress")` encoded as `bls12_381_G1_uncompress`. Decoding and re-encoding an existing script was not affected, because both directions used the same wrong table. Code that matched on these names after decoding, or built terms with them, now gets the Plutus meaning.
