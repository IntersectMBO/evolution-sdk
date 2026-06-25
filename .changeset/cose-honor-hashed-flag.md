---
"@evolution-sdk/evolution": patch
---

`COSE.SignData.verifyData` now honors the CIP-8 `hashed` flag. When a signer hashes a large message, the flag is set and the signed payload is the blake2b-224 digest of the message rather than the message itself. Verification previously ignored the flag and always compared the supplied payload to the signed bytes literally, so a hashed message from a wallet could never be verified against its original payload. Verification now reads the flag and, when set, compares the blake2b-224 digest of the supplied payload, matching the message-signing reference used by browser wallets.

The flag is intentionally left in the unprotected headers to preserve byte-for-byte compatibility with that reference, where the flag also lives in the unprotected map; `signData` output is unchanged.
