# @evolution-sdk/canonical

Canonical encodings for Cardano: RFC 8785 JSON canonicalization, and the CIP-116 JSON shape.

Both exist because something takes a **digest** over their output. An x402 seller authorization
is `SHA-256("…" || JCS(terms))`; a byte that differs from whoever computed the original digest is
a rejected payment or a failed signature check. "Looks right" is not a standard either can be
held to.

## `Jcs` — RFC 8785

A leaf: no imports, nothing Cardano-specific. Sort keys by UTF-16 code unit, emit shortest
escapes, use ECMAScript number formatting.

⚠️ **DEL (0x7f) is not escaped.** RFC 8785 defers to RFC 8259, which requires escaping only below
0x20. Escaping it would produce a digest nobody else computes.

⚠️ This is **not** JSON-LD / RDF-Dataset canonicalization (URDNA2015), which governance metadata
uses and which needs a full JSON-LD to N-Quads stack.

Values with no canonical form — `undefined`, `NaN`, infinities, `bigint`, functions, symbols —
are **refused**. Guessing one produces a digest that is wrong rather than one that is missing.

## `Cip116` — the canonical shape

Scope is the subset a CIP-139 query layer returns: `TransactionUnspentOutput` and everything
inside it. The recursive `Transaction` / `Block` / `NativeScript` encodings are deliberately
absent — their right source is the transaction CBOR and a decoder, not an indexer's flattened
JSON.

⚠️ The scalar conventions are the easy thing to get wrong, so they are stated once:

| field | form |
|---|---|
| `TransactionInput.index` (`UInt32`) | JSON **number** |
| `coin` (`UInt64`), asset amounts (`PosInt64`), `alternative` (`UInt64`) | decimal **strings** |
| addresses | bech32 (Byron: base58), never raw hex |
| `PlutusDataInteger.value` (`BigInt`) | unbounded decimal string |

A number for an amount is a schema violation **and** truncates past 2^53.

⚠️ `PosInt64` is zero-**exclusive**, so a zero-quantity asset entry cannot be represented and is
dropped rather than emitted as `"0"`.

⚠️ `datum_hex` on an output is an **extension**, not CIP-116. `plutus_data` is
information-complete but not byte-exact — the JSON tree does not capture CBOR encoding choices —
so a consumer that must hash or re-submit the datum needs the original bytes. It is schema-legal:
`TransactionOutput` is the one type here that does not set `unevaluatedProperties: false`.

```ts
import { Cip116, Jcs } from "@evolution-sdk/canonical"

const utxo = Cip116.transactionUnspentOutput(
  Cip116.transactionInput(txHash, index),
  { address: bech32, amount: Cip116.value(coin, assets) }
)
const digest = sha256(Jcs.jcsBytes(utxo))
```
