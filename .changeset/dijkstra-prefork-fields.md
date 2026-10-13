---
"@evolution-sdk/dijkstra": minor
---

New package: typed reads of the Dijkstra (pv12) pre-fork `transaction_body` keys, plus the `script_require_guard` native-script variant.

⚠️ **Pre-fork.** It is grounded against the draft ledger CDDL only — no library ships Dijkstra, and the draft has already moved once: field 27 was added, and 26 was re-keyed from a credential to a reward account and gained a third, bare-`coin` arm. Every shape needs re-verifying before it is relied on against a live chain, and the package says so in its README and module docs.

What it reads: `guards` (14, which replaces `required_signers` and is a key-hash set **or** a credential oset), `sub_transactions` (23, as raw sub-transaction CBOR), `required_top_level_guards` (24), `direct_deposits` (25), `account_balance_intervals` (26) and `starting_account_balance_intervals` (27).

The byte layer already survives these: an unrecognised body key is preserved verbatim, so a Dijkstra transaction passes through a Conway-era codec untouched. What was missing is a *reading* of them, which is what a review surface and an analyzer need in order to say what such a transaction does rather than showing a reviewer an opaque key.
