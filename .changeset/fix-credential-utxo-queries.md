---
"@evolution-sdk/evolution": patch
---

Credential-based UTxO queries (`getUtxos` and `getUtxosWithUnit` with a `Credential` instead of an `Address`) now work across all providers that support them. Previously, passing a `Credential` to Blockfrost produced an invalid API path, and Koios silently rejected the query. Blockfrost now encodes credentials as CIP-5 bech32 (`addr_vkh`/`script` prefixes), and Koios routes credential queries to the `POST /credential_utxos` endpoint with hex-encoded payment credential hashes.

- Added `toBech32`/`fromBech32` to `KeyHash` (`addr_vkh` prefix) and `ScriptHash` (`script` prefix)
- Added `Credential.toHex` and `Credential.toBech32` convenience functions
- Fixed `BlockfrostEffect.getUtxosWithUnit` reading the address from `addressPath` instead of the response `utxo.address`
