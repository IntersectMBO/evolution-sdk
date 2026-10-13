---
"@evolution-sdk/evolution": minor
---

`CBORBuilder` offers the append-as-you-go shape over `CBOR`, and `CBOR` gains the byte helpers a splicing caller needs.

Some callers describe a document as they walk it rather than constructing the whole value first. `CBORBuilder.Serializer` gives them that shape while **the bytes are still produced by `CBOR`'s encoder** — writes accumulate a value and its `CBORFormat`, and `finalize()` encodes through `toCBORBytesWithFormat`. It is deliberately not a second encoder: two encoders in one library that must agree byte for byte is a drift hazard. The declared length drives the structure, so an unfinished container is a `finalize()` error rather than malformed bytes a node rejects later. `Deserializer` is the read side, lenient as a CBOR reader should be: non-minimal heads and indefinite containers are accepted, and whole-item skips delegate to `CBOR.decodeItemWithOffsetAndFormat`.

Nothing here streams, and the module says so: `finalize()` needs the whole document and `Deserializer` reads a buffer already in memory.

`CBOR` also exports what a caller splicing pre-encoded children needs: `encodeMapAsDefinite`, `DefiniteArray`, `Raw`, `compareByteKeys` and `sortByteKeyedMap`. The two comparison helpers are the canonical byte-key order in one place, rather than re-derived per call site.
