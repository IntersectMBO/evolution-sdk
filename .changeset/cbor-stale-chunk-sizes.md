---
"@evolution-sdk/evolution": patch
---

Fix preservation-aware encoding reusing stale indefinite chunk sizes for byte and text strings. A captured chunk layout is now reused only when its chunk sizes add up to the new value's length — and, for text, only when every chunk ends on a UTF-8 character boundary. Otherwise the encoder falls back to the default encoding for that string, instead of zero-padding a shorter value, dropping the tail of a longer one, or splitting a UTF-8 character.
