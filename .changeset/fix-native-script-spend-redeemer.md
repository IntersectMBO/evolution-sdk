---
"@evolution-sdk/evolution": patch
---

Fix collectFrom storing redeemers for native script UTxOs. When a redeemer was passed to collectFrom for a native script input, it was incorrectly treated as a Plutus spend, causing "associated script witness is missing" errors during evaluation.
