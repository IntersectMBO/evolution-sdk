---
"@evolution-sdk/evolution": patch
---

`Redeemers.toScriptDataHash` now encodes datums with the codec options it is given. Before, it applied the options to the redeemers only and always wrote datums in the default Plutus data encoding. A hash requested with `CBOR.CANONICAL_OPTIONS` then did not match a witness set holding canonical datums, and the node rejected the transaction. Calls without options produce the same hashes as before.
