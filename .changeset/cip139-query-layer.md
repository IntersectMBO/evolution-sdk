---
"@evolution-sdk/cip139": minor
---

New package: the CIP-139 Universal Query Layer — the read surface that turns an own-data wallet into a full-data one.

CIP-30 serves the user's own addresses and UTxOs, which leaves a dApp with two sources of truth, its own query layer and the wallet's. When they disagree the wallet may refuse to sign a transaction spending a UTxO it has not seen. CIP-139 lets the wallet answer for arbitrary chain data instead.

Method names are the operation names from `cip-0144.md` verbatim (`cip139_getUtxosByAddress`), so a JSON-RPC transport can use them unmodified rather than maintaining a mapping that drifts from the spec.

It is built over the provider port and `@evolution-sdk/review`'s decode seam, so the same query layer works against any backend that implements the port — and a read the backend cannot answer surfaces as an absence rather than as an empty result presented as fact.
