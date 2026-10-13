---
"@evolution-sdk/evolution": minor
---

CDDL conformance for four types, and the codec pairs their siblings already had.

- `pool_params.pool_owners` is `set<addr_keyhash>`, which the chain and CML both write `#6.258`. `PoolParams.PoolOwnersCDDL` writes the tag, and `poolOwnersArray` reads either form.
- `UnitInterval` gains the four-member codec pair (`fromCBORBytes`, `fromCBORHex`, `toCBORBytes`, `toCBORHex`) that every sibling type has, and CML agrees on its bytes.
- `VotingProcedures` exports codecs for `Voter` on its own (`voterToCBORBytes` / `voterToCBORHex` / `voterFromCBORBytes` / `voterFromCBORHex`): a governance UI reads a voter out of a body one at a time, not only as part of the whole map.
- `CostModel` is exported from the package entry point, so cost models can be built without a subpath import.

`MinAda` is new: `MinAda.forOutput(output, coinsPerUtxoByte)` computes the minimum lovelace an output must carry, including the 160-byte UTxO entry overhead the ledger adds, and iterates because raising the coin can lengthen its own encoding.

`NonnegativeInterval.fromDecimal` parses a protocol parameter written as a decimal (`"0.0577"`) into the exact rational the ledger uses, instead of a float; `ceilDiv` sits beside the other exact-rational helpers. `Time` gains the slot/POSIX conversions a TTL needs, and `Label`, `Metadata`, `TransactionMetadatum` and `Certificate` get the conformance fixes their CDDL demands.
