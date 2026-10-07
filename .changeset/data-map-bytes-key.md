---
"@evolution-sdk/evolution": patch
---

A decoded transaction now keeps the original bytes of witness datums and redeemers that contain a Plutus data map whose keys hold byte strings. This covers byte-string keys, list and constructor keys that contain them, and repeated keys. Before, re-encoding the transaction or adding a witness with `Transaction.addVKeyWitnessesHex` rewrote the value under each such key, so the node reported a script data hash mismatch.
