---
"@evolution-sdk/evolution": patch
---

Support Plutus builtin IDs 87–105 (Plutus 1.72.0.0; 101–105 are not yet enabled on any protocol version) and Flat constants for native Value and arrays in UPLC decoding, encoding, and parameter application. Scripts produced by Aiken v1.1.24 can now round-trip and accept parameters without failing on the new builtins or Value constants. This adds serialization support only; it does not enable builtins on a network or evaluate scripts.

Represent arrays with `{ array: elementType }` and an `{ items: [...] }` payload. Represent native Value constants with the exported `ValueConstant` type: `{ entries: [{ currency: Uint8Array, tokens: [{ name: Uint8Array, quantity: bigint }] }] }`. Encoding and decoding reject unordered or duplicate keys, keys longer than 32 bytes, empty token maps, zero quantities, and quantities outside the signed 128-bit range. Encoding also rejects wrongly shaped Value payloads with a `UPLCError`.

BLS12-381 type tags 9–11 now decode as the types `BLS12_381_G1_Element`, `BLS12_381_G2_Element` and `BLS12_381_MlResult`, as in Plutus, so an empty list or array of BLS elements round-trips, as in the `multiScalarMul` conformance programs. Decoding or encoding a BLS element itself still throws, because Plutus gives these elements no Flat form.

Constant type decoding now matches Plutus's `decodeKindedUni`. A missing type tag was previously read as `Unit`, so `[]` decoded as a unit and a truncated application such as `[7, 5]` as a list of units, and a single trailing `0` tag was ignored, so `[0, 0]` decoded as an integer. Both are now rejected, because re-encoding them changed the script bytes. Previously every type containing tag 12 or 13 was rejected, because arrays and Value were not supported.
