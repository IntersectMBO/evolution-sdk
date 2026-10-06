---
"@evolution-sdk/evolution": patch
"@evolution-sdk/devnet": patch
---

`.propose()` can now run the constitution's guardrail script. `ProposeParams` takes an optional `redeemer` (and `label`), which the builder adds under the propose purpose at the proposal's index, evaluates and balances like any other script redeemer. Provide the guardrail script with `.attachScript()` or `.readFrom()`. This makes `TreasuryWithdrawalsAction` and `ParameterChangeAction` submittable on networks whose constitution has a guardrail, such as mainnet. The build now fails early when a proposal with a Plutus `policyHash` has no redeemer or no guardrail script, when a redeemer is given for a proposal that runs no guardrail, or when a self redeemer is passed.

Native scripts carried by a spent input are now recognized for voters, certificates and proposals, and their signers are counted in the fee estimate.

The devnet `ConwayGenesis` type accepts an optional `constitution.script` guardrail hash.
