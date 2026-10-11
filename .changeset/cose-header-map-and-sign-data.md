---
"@evolution-sdk/evolution": minor
---

The COSE header map is keyed structurally, and CIP-8 sign-data gets the surface a wallet and a device need.

`HeaderMap` holds a `Map` keyed by the Label **object**, and every `labelFromInt(n)` / `labelFromText(s)` call builds a fresh one — so both accessors answered by identity, which no caller can satisfy: `getHeader` never found a label that was present, and `setHeader` appended rather than replaced, leaving a COSE header map with a duplicate key whose two values both encode and whose reader takes whichever it reaches first.

On top of that:

- `SignData.signData` and `assembleSignData` produce a CIP-8 `COSESign1` — assembling separately from signing is what a hardware wallet needs, because the device returns a signature over bytes the caller must then frame.
- `SignData.verifyMessage` verifies one, and `SignData.addressSignerCredential` reports which credential a protected `address` header claims, or `undefined` when it claims none. A verifier that checks the signature alone accepts a perfectly valid signature over an address the key has nothing to do with; CIP-8's first check is what makes that false, and it needs the claimed credential to run.
- `COSEKey.publicKey` reads the verification key out of a `COSE_Key`, which is what a verifier is handed in the CIP-30 flow.
- The `kid` (label 4) carries the signing public key through the protected headers. It is optional in CIP-8 and CIP-30 wallets differ, so a verifier holding only the signed message needs it present when the signer chose to include it, and must not depend on it when they did not.
