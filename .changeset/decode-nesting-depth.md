---
"@evolution-sdk/evolution": patch
---

Decoding no longer fails on data nested thousands of levels deep. `Data.fromCBORHex("81".repeat(1250) + "00")`, a list nested 1,250 levels deep, threw `ParseError` over "Maximum call stack size exceeded", and `CBOR.fromCBORHex` threw `RangeError` from about 1,700 levels. The ledger accepts data nested as deep as a transaction allows. One UTxO holding such a datum made `getUtxos` fail for its whole address on Blockfrost and Kupmios, and in CIP-30 wallets. The CBOR decoder now passes anything deeper than 64 levels to a decoder that keeps its place on an explicit stack. The conversion from CBOR to Plutus data no longer recurses, so data of any depth decodes.

- `Data.fromCBORBytes` and `Data.fromCBORHex` decode directly instead of through the `Data.FromCBORBytes` schema; the 24,000 golden test datums decode in 75 ms instead of 5.5 s. They still throw `ParseError` with the same message underneath, without the schema path lines above it.
- The providers build each decoded inline datum without validating it a second time.
- Koios and Maestro still fail from about 1,250 levels, in the JSON parsing of their responses. Encoding, comparing and hashing such data still recurse.
