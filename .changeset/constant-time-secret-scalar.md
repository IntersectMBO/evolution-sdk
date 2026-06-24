---
"@evolution-sdk/evolution": patch
---

Key derivation and signing now use constant-time scalar multiplication for secret key material. Several call sites that derive a public key from a secret scalar used a variable-time base-point multiplication whose execution time depends on the secret, leaking information through a timing side channel. The affected paths were private-key public-key derivation, extended-key signing, verification-key derivation, and the BIP32 child derivation, public-key, and 128-byte export/import paths.

These sites now use the constant-time multiplication that was already in use for the per-signature nonce. Results are identical for valid keys, so derived public keys and signatures are unchanged; an all-zero scalar (only reachable from an invalid imported key) now raises an error instead of returning a degenerate point.
