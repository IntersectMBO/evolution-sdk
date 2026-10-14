---
"@evolution-sdk/evolution": patch
---

Maestro responses now decode when the fields the Maestro spec marks optional/nullable arrive `null` or missing: `plutus_cost_models.plutus_v3` (maps to an empty cost model), a UTxO's `datum` and `reference_script`, a datum's `bytes` and `json`, a paginated response's `next_cursor`, and an account's `delegated_pool`. Previously any of these failed the whole call with a schema decode error. The three protocol parameters the public `ProtocolParameters` type requires (`delegate_representative_deposit`, `governance_action_deposit`, `min_fee_reference_scripts`) are also accepted as `null`/missing by the schema, and the transform then fails with a clear `ProviderError` naming the field instead of an opaque decode error — no default is invented for them.
