---
"@evolution-sdk/evolution": patch
---

The provider now reads `cost_models_raw` from the `/epochs/latest/parameters` response instead of the legacy `cost_models` field. The legacy field uses alphabetically-keyed names and is truncated post-Plomin (297 entries vs 350 canonical for PlutusV3), which produces an incorrect `script_data_hash` and causes `ScriptIntegrityHashMismatch` on any transaction carrying Plutus scripts. Falls back to `cost_models` for older API deployments that don't serve `cost_models_raw`.
