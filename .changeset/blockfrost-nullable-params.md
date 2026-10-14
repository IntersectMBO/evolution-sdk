---
"@evolution-sdk/evolution": patch
---

Blockfrost protocol parameters now accept `null` for the 15 fields the Blockfrost OpenAPI spec marks nullable (`max_val_size`, `cost_models`, `cost_models_raw`, `price_mem`, `price_step`, `max_tx_ex_mem`, `max_tx_ex_steps`, `max_block_ex_mem`, `max_block_ex_steps`, `collateral_percent`, `max_collateral_inputs`, `coins_per_utxo_size`, `min_fee_ref_script_cost_per_byte`, `drep_deposit`, `gov_action_deposit`). Previously one `null` failed the whole `getProtocolParameters` decode; the decoded `null` now reaches the transform, whose existing defaults apply.
