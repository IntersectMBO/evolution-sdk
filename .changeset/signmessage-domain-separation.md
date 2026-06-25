---
"@evolution-sdk/evolution": patch
---

The seed/private-key wallet's `signMessage` now signs through a COSE_Sign1 structure instead of signing the caller's bytes directly. Previously it signed the raw payload with the same key and primitive used for transactions, so passing a 32-byte transaction body hash produced a valid transaction witness — making `signMessage` usable as a transaction-signing oracle. The signed bytes are now domain-separated by the COSE `Sig_structure` (the "Signature1" context plus the address in the protected headers), so they can never be a bare transaction witness. The result's `signature` is the COSE_Sign1, matching the format already returned by the CIP-30 wallet path.
