---
"@evolution-sdk/evolution": patch
---

`authCommitteeHot` and `resignCommitteeCold` now build with a Plutus-script cold credential. The builder emits the certificate's redeemer at the certificate's index and evaluates it. Before, neither transaction assembly nor script evaluation matched the committee cold credential to its certificate, so the build failed in evaluation.
