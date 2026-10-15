---
"@evolution-sdk/evolution": patch
---

Fix reward and vote redeemer indices to follow the ledger's `Ord` order (type-first, then hash) instead of hash-only ordering. Withdrawals are now sorted by `Ord Credential` (script-hash credentials before key-hash credentials, then hash bytes) in both assembly and evaluation, and `voterToKey` encodes each voter's credential rank (script before key) into the key so sorting voter keys reproduces `Ord Voter`. Previously, a transaction mixing a script credential and a key credential whose hashes interleaved against the type order placed the redeemer at the wrong index and was rejected by the ledger with MissingRedeemers / ExtraRedeemers.
