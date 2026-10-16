---
"@evolution-sdk/evolution": patch
---

Wallet `signMessage` now returns the complete CIP-30 `DataSignature`: the wallet `SignedMessage` interface gains a `key` field carrying the hex-encoded COSE_Key. The seed/private-key wallet returns the key `SignData.signData` already produces, and the CIP-30 api wallet carries the extension's `key` through, so a consumer can call `verifyData` with only the returned `{ signature, key }` instead of obtaining the public key some other way.
