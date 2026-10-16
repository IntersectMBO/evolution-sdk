---
"@evolution-sdk/evolution": patch
---

Decoding deeply nested CBOR no longer overflows the call stack. The ledger limits the size of each leaf of Plutus data, not its depth, so a datum can nest roughly as deep as the transaction size allows (around 16,000 levels); `CBOR.fromCBORHex` failed with `RangeError` from about 1,719 levels and `Data.fromCBORHex` with a `ParseError` wrapping one from about 1,250. The offset CBOR decoder now runs on an explicit stack instead of recursing once per level, `cborValueToPlutusData` converts on an explicit action stack with structural type guards (the `Schema.is` guards validated each subtree recursively), and `Data.fromCBORBytes` / `Data.fromCBORHex` decode through those two functions directly, keeping the `ParseError` failure surface, instead of through the recursive schema parser. The `FromCBORBytes` / `FromCBORHex` / `FromCDDL` schemas keep their existing validation behaviour.
