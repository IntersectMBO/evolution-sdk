---
"@evolution-sdk/evolution": minor
---

A proposal procedure now requires an anchor. The ledger has no null anchor for a proposal, so the node rejected a transaction whose proposal had one as malformed. Before, `ProposalProcedure` accepted `anchor: null` and wrote it as CBOR null.

`ProposalProcedure.anchor`, the `anchor` parameter of `ProposalProcedures.single` and `ProposeParams.anchor` for `propose()` are now `Anchor.Anchor`. Decoding a proposal procedure with a null anchor fails. Callers that passed `null` must pass an anchor with the metadata URL and hash of the proposal. Voting procedure anchors can still be null.
