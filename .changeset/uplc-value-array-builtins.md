---
"@evolution-sdk/evolution": patch
---

Support Plutus builtin IDs 87–105 (Plutus 1.72.0.0; 101–105 are not yet enabled on any protocol version) and Flat constants for native Value and arrays in UPLC decoding, encoding, and parameter application. Scripts produced by Aiken v1.1.24 can now round-trip and accept parameters without failing on the new builtins or Value constants. This adds serialization support only; it does not enable builtins on a network or evaluate scripts.

Represent arrays with `{ array: elementType }` and an `{ items: [...] }` payload. Represent native Value constants with the exported `ValueConstant` type: `{ entries: [{ currency: Uint8Array, tokens: [{ name: Uint8Array, quantity: bigint }] }] }`. Encoding and decoding reject unordered or duplicate keys, keys longer than 32 bytes, empty token maps, zero quantities, and quantities outside the signed 128-bit range. Encoding also rejects wrongly shaped Value payloads with a `UPLCError`. BLS element constants remain unsupported because they cannot be Flat-serialized in scripts.

Constant type decoding now matches Plutus's `decodeKindedUni`: an empty or truncated type application (for example `[7, 12, 7, 5]`) and leftover type tags (for example `[13, 0]` or `[0, 0]`) are rejected. They were previously read as `Unit` or dropped, which changed the script bytes on re-encode.
