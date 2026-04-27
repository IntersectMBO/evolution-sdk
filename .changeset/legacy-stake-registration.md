---
"@evolution-sdk/evolution": patch
---

Add `registerStakeLegacy` and `deregisterStakeLegacy` builder methods for pre-Conway stake certificate support. These create `StakeRegistration` (CDDL tag 0) and `StakeDeregistration` (CDDL tag 1) certificates with no deposit, matching what most wallets use today. Both methods support script-controlled credentials with redeemers.
