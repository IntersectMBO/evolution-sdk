---
"@evolution-sdk/evolution": minor
---

The new `CBOR.PLUTUS_DATA_OPTIONS` preset encodes Plutus data in the layout the node writes. It writes non-empty lists and constructor fields with indefinite length, maps with definite length, the empty list as `80`, and the empty map as `a0`.

`UPLC.applyParamsToScript` and `UPLC.dataConstant` now encode parameters with `PLUTUS_DATA_OPTIONS` by default, so a map parameter gives the same bytes and script hash as `aiken blueprint apply`. Before, a map parameter became a list of pairs, which is a different value and gives a different script hash. Scripts applied with map parameters therefore get a new hash.

`CBOR.AIKEN_DEFAULT_OPTIONS` now matches Aiken `cbor.serialise()`, which writes `Pairs` as a definite map, and is deprecated in favor of `PLUTUS_DATA_OPTIONS`. The new `CBOR.CML_DATA_DEFINITE_OPTIONS` writes lists and maps with definite length, like CML `PlutusData.to_cbor_hex()`. `CBOR.CARDANO_NODE_DATA_OPTIONS` is deprecated in favor of it, since the node does not write that layout.

The default for `Data` encoding stays `CBOR.CML_DATA_DEFAULT_OPTIONS`, and transaction encoding is unchanged.
