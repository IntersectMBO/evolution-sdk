---
"@evolution-sdk/cip30": minor
---

New package: the CIP-30 wallet read surface over a provider and an account, returning the exact wire encodings — plus CIP-95 governance keys, CIP-103, CIP-104 and CIP-142.

The scope is deliberately the **read** surface. It does not carry `signTx` / `signTxs` / `signData`: a signing method reachable straight off a connector is a footgun for anyone embedding it, and this package owns byte-exactness, not authorization. A wallet answers signing requests with a sentinel its host catches and then runs its own review and key-custody ceremony. The signing *encodings* live in `ReferenceSigning`, separate and labelled unsafe, so they can be tested without being reachable by accident.

`getAccountPublicKey` is consent-gated. It reveals every address a wallet has used and its whole history, and CIP-30 treats it as a transparent read, so nothing else in a wallet's flow would prompt for it. The method *requires* a `ConsentTag`, which makes it type-level impossible to serve without the embedding app's approval implementation.

The returned shapes are the wire's, not a convenience: `getChangeAddress` answers raw address bytes as hex rather than bech32, and `getUtxos` / `getBalance` answer `TransactionUnspentOutput` and `Value` hex, because a dApp compares those strings against what it built.
