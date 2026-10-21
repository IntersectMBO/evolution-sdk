---
"@evolution-sdk/evolution": patch
---

The Blockfrost provider now reports an output that holds a datum hash with a `DatumHash` datum option, as Koios, Maestro and Kupmios do. Before, `getUtxos`, `getUtxosWithUnit`, `getUtxoByUnit` and `getUtxosByOutRef` fetched the datum behind each hash and returned it as an `InlineDatum`, so the UTxO did not match the chain. Re-encoding such a UTxO wrote an inline datum where the chain holds a hash, and the builder could not see that spending it needs the datum in the witness set. Code that read a hash output's datum from `datumOption.data` should call `getDatum(datumHash)` instead. The UTxO queries also make one request fewer for each datum-hash output.
