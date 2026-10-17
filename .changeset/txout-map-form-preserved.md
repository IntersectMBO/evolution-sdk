---
"@evolution-sdk/evolution": patch
---

Outputs decoded in the post-Alonzo map form no longer come back in the legacy array form on re-encode. The captured format now decides the form: when the format node for an output (or the collateral return) is a map, the encoded output is rebuilt as a map — with a bare datum hash wrapped as the datum_option `[0, hash]` — so the format replays and a plain round trip reproduces the input bytes exactly, leaving the transaction id unchanged. Array-form outputs, outputs with an inline datum or script ref, and freshly built transactions are unchanged.
