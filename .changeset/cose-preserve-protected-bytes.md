---
"@evolution-sdk/evolution": patch
---

COSE_Sign1 decoding now preserves the original protected-header bytes and replays them in `signedData()` and on re-encode, instead of rebuilding the Sig_structure from a canonical re-encode of the parsed HeaderMap. Per RFC 9052 the protected header is a `bstr` whose exact bytes are what the signature covers, so a valid signature from a signer whose protected-header encoding is non-minimal (for example a label written as a two-byte uint) is no longer rejected by `verifyData`, and a decode/encode round trip reproduces the received bytes.
