---
"@evolution-sdk/evolution": minor
---

`UPLC` now decodes and encodes the full Plutus V3 builtin table and the `Value` and `Array` constant types, so `fromCborHexToProgram` and `applyParamsToScript` work on scripts that Aiken v1.1.24 emits — for example validators using `value.contains` or `value.from_assets`.

- `BuiltinFunctions` gains the 19 builtins at flat ids 87–105, in the order of `PlutusCore/Default/Builtins.hs` (plutus 1.72.0.0): `expModInteger`, `dropList`, `lengthOfArray`, `listToArray`, `indexArray`, `bls12_381_G1_multiScalarMul`, `bls12_381_G2_multiScalarMul`, `insertCoin`, `lookupCoin`, `unionValue`, `valueContains`, `valueData`, `unValueData`, `scaleValue`, `multiIndexArray`, `policies`, `assetCount`, `keepPolicies`, `dropPolicies`.
- `DataType` gains the `Value` primitive (tag 13) and an `{ array }` variant (tag 12, applied with tag 7 like `list`). A `Value` constant is a new `ValueConstant`: a list of `(currency symbol, [(token name, quantity)])` entries. Decoding applies the validation of Plutus' `buildValueWith` — currency symbols and token names strictly ascending, no empty inner list, no zero quantity, keys of at most 32 bytes, quantities within signed 128-bit bounds — and encoding writes entries in that map order and checks the same invariants. Type tags 9–11 (the BLS12-381 element types) are still rejected, now with a message stating they have no flat serialisation in scripts.
