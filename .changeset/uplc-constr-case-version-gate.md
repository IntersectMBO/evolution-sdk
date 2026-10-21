---
"@evolution-sdk/evolution": patch
---

UPLC Flat decoding now rejects `constr` and `case` terms in a program whose version is below 1.1.0, as Plutus's `decodeTerm` does. It also reads the `constr` tag as Plutus's Word64 decoder does, rejecting a value of 2^64 or more and an encoding longer than ten 7-bit chunks. Before, such programs decoded without error. The encoder now refuses `constr` and `case` before 1.1.0 and `constr` tags above 2^64 - 1; before, it wrote e.g. `(program 1.0.0 (constr 0))` as `0100008001`, which Plutus cannot decode.

Program version components are now read and written as Flat naturals, as in Plutus. Before, each was a single byte, so a component of 128 or more was misread, and one of 256 or more was truncated: `257.0.0` was written as `1.0.0`. Versions with every component below 128 encode to the same bytes as before.
