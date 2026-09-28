---
"@evolution-sdk/evolution": patch
---

Read every integer in provider responses exactly, at any size. The HTTP helpers parsed response bodies with `JSON.parse`, which rounds any integer above 2^53, and the provider schemas mixed `number` and `bigint` for integer fields. The HTTP helpers now decode each body with one composed `Schema.parseJson` schema whose reviver hands every JSON number to the field schema as the text the server wrote. Every integer field in the Koios, Kupo, Ogmios, Blockfrost and Maestro response schemas decodes with `Schema.BigInt`, and decimal fields decode with `Schema.NumberFromString`.

- Koios lovelace fields decode whether Koios sends them as strings, as it does today, or as JSON numbers, as it will from v1.5 (#539).
- Kupo token quantities above 2^53 are no longer rounded (#454).
- `awaitTx` on Koios reads only the transaction hash from `/tx_info`.
- A response body that is not the expected JSON now fails with a `ParseError` instead of an `HttpResponseError`. Public provider methods still fail with `ProviderError` in both cases.
- This release keeps the public `Provider.ProtocolParameters` type as it was. Each provider converts the fields it declares as `number` at that boundary, and #557 tracks moving them to `bigint`.
