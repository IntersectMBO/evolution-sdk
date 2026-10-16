---
"@evolution-sdk/evolution": patch
---

`Transaction.addVKeyWitnessesHex` and `Transaction.addVKeyWitnessesBytes` now write the vkey witnesses key at its ascending position when the decoded witness set keys ascend. A transaction that passes a hardware wallet's canonical check stays canonical after each signature, so a second hardware wallet can witness it.

This changes the bytes these functions write by default. Signing an unsigned transaction whose witness set holds keys 5 and 7 now writes key 0 first, where it came last before. The transaction id, the body bytes and the bytes of each existing entry stay the same. The same holds for `Transaction.addVKeyWitnesses` followed by `Transaction.toCBORHex`, and for a key added through `Transaction.toCBORHexWithFormat` or `TransactionWitnessSet.toCBORHexWithFormat`. A witness set whose decoded keys do not ascend still gets the new key last.
