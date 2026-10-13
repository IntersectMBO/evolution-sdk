---
"@evolution-sdk/cip113": minor
---

A transfer refuses an input carrying a non-void inline datum, rather than leaving it behind.

A programmable output may carry an inline datum of any content within `max_inline_datum_bytes`, and the protocol names CIP-68 reference tokens as the legitimate large case. `buildTransferTx` writes only the datums a caller supplies, so it cannot overwrite one — but it could do the quieter version of the same damage: move such an input, emit the output with no datum, and the metadata is gone from the live UTxO set just as permanently.

⚠️ This is a measured failure class, not a hypothetical. The reference SDK was asked to transfer a CIP-68 (100) reference token: it built the transaction, the **ledger accepted it**, and the output's datum came out as `d87980` where the metadata had been — leaving the reference NFT at an address its issuer no longer controlled. Nothing failed: not the build, not the evaluation, not the submission, not its suite. Two independent implementations have since added a guard; this is the third.

Refusing rather than carrying the datum forward is deliberate: whether the on-chain transfer validator accepts a non-void datum on a programmable output is untested here, so a carry-forward would trade silent data loss for a submission failure nobody can read. The refusal is the part provable offline, and a caller who means to move metadata says so by supplying the output's datum explicitly.

The void datum (`d87980`) and no datum at all both build as before.
