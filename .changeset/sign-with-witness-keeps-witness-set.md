---
"@evolution-sdk/evolution": patch
---

`SignBuilder.signWithWitness` now keeps the transaction's own witness set and adds the vkey and bootstrap witnesses of the given set. Before, it built the signed transaction from the given set alone. A Plutus transaction signed with only the vkey witnesses a hardware wallet returns lost its scripts, datums and redeemers. It skips a vkey witness the transaction already holds and adds a repeated one once. It ignores scripts, datums and redeemers in the given set, since the body's script data hash covers the transaction's own.
