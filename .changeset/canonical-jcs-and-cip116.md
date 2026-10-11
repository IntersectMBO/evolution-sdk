---
"@evolution-sdk/canonical": minor
---

New package: RFC 8785 JSON canonicalization (`Jcs`) and the CIP-116 JSON shape (`Cip116`).

Both exist because something takes a **digest** over their output. A byte that differs from whoever computed the original digest is a rejected payment or a failed signature check, so "looks right" is not a standard either can be held to.

`Jcs` is a leaf — no imports, nothing Cardano-specific: keys sorted by UTF-16 code unit, shortest escapes, ECMAScript number formatting. Two things it is explicit about: **DEL (0x7f) is not escaped**, because RFC 8785 defers to RFC 8259 which requires escaping only below 0x20, and escaping it would produce a digest nobody else computes; and it is **not** JSON-LD / RDF-Dataset canonicalization (URDNA2015), which is what governance metadata uses and which needs a full JSON-LD to N-Quads stack.

Values with no canonical form — `undefined`, `NaN`, infinities, `bigint`, functions, symbols — are refused rather than coerced. Guessing one produces a digest that is wrong rather than one that is missing.
