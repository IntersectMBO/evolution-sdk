---
"@evolution-sdk/evolution": patch
---

Decoding a transaction body refuses a key the schema does not model, instead of dropping it. The decoder reads its fields by key, so a key it never reads is absent from the result and missing from the re-encode: measured on a mainnet transaction, a body given one extra key went in at 1271 bytes and came back out as the original 1268, byte for byte, with nothing raised, as a different transaction with a different id. Every valid Conway body key is modelled, so an unmodelled key is either a pre-Conway field this schema cannot represent or a field from a newer era, and carrying the bytes through would let a wallet sign a field it cannot display.
