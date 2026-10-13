---
"@evolution-sdk/evolution": patch
---

The tag-102 constructor wrapper is now written as a definite two-element array.

`Data` encodes a constructor whose index is outside the compact ranges as `#6.102([index, fields])`. The wrapper array was written with indefinite-length framing, so `Constr(999999, [42])` encoded as `d8669f1a000f423f9f182affff`. The fields array inside it is indefinite, and the wrapper is not.

Two independent implementations write the definite form, and disagree with each other about the fields framing while agreeing about the wrapper:

- `cardano-serialization-lib` 15.0.3 writes `d866821a000f423f9f182aff`
- `cardano-multiplatform-lib` 6.2 writes `d866821a000f423f81182a`

Both write `d866821a000f423f80` when there are no fields, which this library already matched.

Framing is pinned on the node rather than taken from the codec options, because the wrapper is definite while the fields array one level in is indefinite, and a single option cannot say both. `CBOR.DefiniteArray` is the node, alongside the existing `CBOR.BoundedBytes`; it threads the decoded format to its items, so anything nested inside still replays the framing it arrived with.

This changes the bytes of any transaction carrying a constructor with an index above 127, and therefore its datum hash and its transaction id. The golden corpora move for exactly those values.
