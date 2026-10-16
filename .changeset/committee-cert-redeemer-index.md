---
"@evolution-sdk/evolution": patch
---

Fix committee certificate redeemers never reaching the built transaction. `authCommitteeHot` and `resignCommitteeCold` store a Plutus-script cold credential's redeemer under `cert:{coldCredentialHash}`, but transaction assembly only matched certificates on `stakeCredential` and `drepCredential`, and script evaluation built its certificate index map from the same two fields — so the redeemer was dropped, evaluation failed, and a transaction carrying a script-controlled committee certificate could not be built. Both lookups now also match `committeeColdCredential`, so the redeemer is emitted at the certificate's own index with its evaluated ExUnits. Native-script cold credentials are unaffected (they need no redeemer), as are key-hash cold credentials.
