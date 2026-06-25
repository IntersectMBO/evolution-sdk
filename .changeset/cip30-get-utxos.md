---
"@evolution-sdk/evolution": minor
---

CIP-30 wallets can now provide typed UTxOs directly, without going through a provider. The API wallet exposes `getUtxos()` returning parsed `UTxO` values, and a new `Codegen`-free helper `cip30UtxoFromCBORHex` converts a single CIP-30 UTxO (the CBOR of a `[transaction_input, transaction_output]` pair) into a `UTxO`. Previously the only built-in source of wallet UTxOs was the provider (`getWalletUtxos` resolved the address and queried `provider.getUtxos`), so consumers had to parse the wallet's CBOR themselves.

Transaction building and `getWalletUtxos` now prefer the wallet's own UTxOs when the wallet is a CIP-30 wallet, falling back to the provider for seed and private-key wallets. This reflects the wallet's own view, including UTxOs created by transactions it has just submitted, so chained transactions no longer wait for a provider to index them. A provider is still required for protocol parameters during build, since CIP-30 does not expose them.
