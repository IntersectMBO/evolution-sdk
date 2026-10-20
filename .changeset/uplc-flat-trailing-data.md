---
"@evolution-sdk/evolution": patch
---

UPLC Flat decoding now rejects a program with input left after its final filler, or with no final filler, as Plutus does (`postAlignedDecoder` with `strictDecoder`). Before, decoding stopped after the first complete term and ignored the rest. A script that was misread or truncated therefore decoded without error, and `applyParamsToScript` or a re-encode could silently produce a different, shorter script.
