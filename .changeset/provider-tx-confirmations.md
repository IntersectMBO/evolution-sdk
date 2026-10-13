---
"@evolution-sdk/evolution": minor
---

`ProviderEffect` gains `getTxConfirmations`: how many blocks deep the chain considers a transaction, or `null` when it has not seen it.

`awaitTx` answers presence, which is a weaker question than the one a wallet has to ask. Cardano's finality is probabilistic, so a one-deep transaction can still be rolled back, and a flow that must not act twice on the same funds needs depth rather than inclusion. Answering a request for depth with an inclusion fact is the dangerous kind of wrong.

The block containing a transaction counts as the first confirmation, so a freshly included transaction answers `1`. An unseen one answers `null` rather than `0`: zero deep is not a state a transaction on chain is ever in, and conflating the two would make "never submitted" and "just included" the same answer. Optional, like the rest of the tier — Koios implements it from `/tx_status`; a backend that cannot report depth omits it, so a caller can say the count is unavailable instead of inventing one.
