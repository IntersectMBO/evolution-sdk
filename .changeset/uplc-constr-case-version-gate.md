---
"@evolution-sdk/evolution": patch
---

UPLC Flat decoding now rejects `constr` and `case` terms in a program whose version is below 1.1.0, and a `constr` tag that does not fit in a Word64, as Plutus's `decodeTerm` does. Before, such programs decoded without error, and the encoder wrote them, e.g. `(program 1.0.0 (constr 0))` as `0100008001`, which Plutus cannot decode. The encoder now refuses these terms too.
