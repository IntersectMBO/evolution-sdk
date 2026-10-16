---
"@evolution-sdk/evolution": patch
---

Key-hash governance voters are now added to the required signers. `computeRequiredKeyHashesSync` inspects `votingProcedures`: a key-hash DRep voter or constitutional-committee voter matching the wallet's stake credential adds the stake key, and a stake-pool voter matching the wallet's payment key hash adds the payment key, mirroring the existing certificate handling — so a seed wallet now signs a governance vote it cast. The tx builder's Vote operation likewise records key-hash voters in the body's `requiredSigners` (deduplicated), so built transactions ask for those witnesses.
