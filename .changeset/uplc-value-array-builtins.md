---
"@evolution-sdk/evolution": patch
---

Support the stable Plutus builtin IDs 87–105 and Flat constants for native Value and arrays in UPLC decoding, encoding, and parameter application. Scripts produced by Aiken v1.1.24 can now round-trip and accept parameters without failing on the new builtins or Value constants. This adds serialization support only; it does not enable builtins on a network or evaluate scripts.

Represent arrays with `{ array: elementType }` and an `{ items: [...] }` payload. Represent native Value constants with the exported `ValueConstant` type: `{ entries: [{ currency: Uint8Array, tokens: [{ name: Uint8Array, quantity: bigint }] }] }`. Encoding and decoding reject unordered or duplicate keys, keys longer than 32 bytes, empty token maps, zero quantities, and quantities outside the signed 128-bit range. BLS element constants remain unsupported because they cannot be Flat-serialized in scripts.
