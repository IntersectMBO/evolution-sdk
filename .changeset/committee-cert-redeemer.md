---
"@evolution-sdk/evolution": patch
---

`authCommitteeHot` and `resignCommitteeCold` now build with a Plutus-script cold credential. The builder emits the certificate's redeemer at the certificate's index and evaluates it. Before, neither transaction assembly nor script evaluation matched the committee cold credential to its certificate, so the build failed in evaluation.

A redeemer that the builder cannot place at an index now fails `build()` and names the redeemer key. Before, the builder logged a warning and left the redeemer out of the transaction, which the node then rejected. `mintAssets` no longer registers a redeemer for a policy whose amounts are all zero, since that policy is not minted.
