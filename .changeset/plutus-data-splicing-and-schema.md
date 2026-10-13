---
"@evolution-sdk/evolution": minor
---

A `Data` can be spliced from children that are already encoded, and it has a schema that does not copy it.

`Data.spliceList`, `spliceConstr` and `spliceMap` assemble a parent from children whose bytes a caller already holds. That is what keeps a datum hash stable across a layer that only reframes a parent: re-encoding the children would recompute their bytes, and any framing difference in a child changes the hash of everything above it.

`Data.DataValue` is a `Schema.declare` over the variant, with `Data.isData` beside it. A `Schema.Class` validation **copies** the value, and a copy is a different object identity — which silently breaks a `WeakMap` keyed on the decoded value, the mechanism that carries a decoded node's arrival bytes. Declaring the schema validates in place instead.

`plutusDataToCBORValue` takes `CodecOptions` and `cborValueToPlutusData` takes a `CBORFormat`, so a caller that decoded with one set of options can re-encode under the same ones. `InlineDatum.fromCBORHex` / `fromCBORBytes` are the inverse of its existing encoders, which the module did not have.
