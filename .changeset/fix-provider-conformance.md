---
"@evolution-sdk/evolution": patch
---

Fix several provider mapping bugs that caused incorrect or missing data in `getDelegation`, `getDatum`, and `getUtxos` responses.

**Koios**

- `getDelegation`: was decoding the pool ID with `PoolKeyHash.FromHex` but Koios returns a bech32 `pool1…` string — switched to `PoolKeyHash.FromBech32`
- `getUtxos`: `datumOption` and `scriptRef` fields were never populated — all UTxOs returned `datumOption: null, scriptRef: null` regardless of on-chain state. Now correctly maps inline datums, datum hashes, and native/Plutus script references.

**Kupmios (Ogmios)**

- `getDelegation`: the Ogmios v6 response is an array, but the code was using `Object.values(result)[0]` which silently produced wrong data on some responses. Switched to `result[0]`. Also corrected the field path from `delegate.id` to `stakePool.id` to match the v6 schema, and decoded the bech32 pool ID through `Schema.decode(PoolKeyHash.FromBech32)` so the return type satisfies `Provider.Delegation`.

**Blockfrost**

- `getDatum`: was calling `/scripts/datum/{hash}` which returns only the data hash — should be `/scripts/datum/{hash}/cbor` to get the actual CBOR-encoded datum value. Switched endpoint and response schema to `BlockfrostDatumCbor`.

**Koios (asset_list)**

- `awaitTx` / `getTxInfo`: Koios sometimes returns `collateral_output.asset_list` as a Haskell show-formatted string instead of a JSON array. The schema now tolerates strings by coercing them to `null`.

**All providers**

- `awaitTx`: added an optional `timeout` parameter (third argument) so callers can control how long to wait before giving up. Each provider has a sensible default (Blockfrost: 300s, others: 160s). Maestro previously had no timeout at all.
