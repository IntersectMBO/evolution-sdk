---
"@evolution-sdk/evolution": patch
---

`COSE.SignData.verifyData` now binds the signing key to the claimed address. Previously it checked the protected-header address and the public-key hash as two independent caller-supplied claims and never required the public key in the signed message to match the credential contained in the address. A signature produced by one key carrying a different address in its protected header would still verify, so address-based authentication and attestation flows could accept a proof from the wrong signer.

Verification now decodes the claimed address, derives its key-hash credential (the payment credential for base and enterprise addresses, the stake credential for reward addresses), and requires the embedded public key to hash to that credential. Addresses whose credential is a script hash are rejected, since a single Ed25519 key cannot satisfy a script credential. Genuine signatures whose key matches the address continue to verify unchanged.
