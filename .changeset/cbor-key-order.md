---
"@evolution-sdk/evolution": minor
---

`CBOR.CodecOptions` takes a `keyOrder` option, the order of map keys when the encoder sorts them: in canonical mode, and in custom mode with `sortMapKeys: true`.

- `"lengthFirst"`, the default, puts the shorter encoded key first and orders keys of equal length bytewise (RFC 7049 Section 3.9).
- `"bytewise"` orders the encoded keys bytewise, and a key that is a prefix of another comes first (RFC 8949 Section 4.2.1).

```ts
const datum = Data.map([[1000n, 1n], [-1n, 2n]])
Data.toCBORHex(datum, CBOR.CANONICAL_OPTIONS) // a220021903e801: -1 (20) is shorter than 1000 (1903e8)
Data.toCBORHex(datum, CBOR.HW_CLI_OPTIONS) // a21903e8012002: 1000 (19...) sorts before -1 (20)
```

Two new presets write the bytewise order, which hardware wallet tooling checks before it witnesses a transaction:

- `CBOR.HW_CLI_OPTIONS`: `{ mode: "canonical", keyOrder: "bytewise" }`.
- `CBOR.TX_HW_CLI_OPTIONS`: `CBOR.HW_CLI_OPTIONS` for both `ledger` and `plutusData`.

No preset passes that check when a redeemer or a witness datum holds a byte string over 64 bytes, the bytes of a bignum included. Plutus requires such a string in 64-byte chunks, and the check requires it in one piece.

Every existing preset writes the same bytes as before. `CBOR.CANONICAL_OPTIONS` and `CBOR.TX_CANONICAL_OPTIONS` keep the length-first order, and their documentation now cites RFC 7049 Section 3.9 for it instead of RFC 8949 Section 4.2.1.
