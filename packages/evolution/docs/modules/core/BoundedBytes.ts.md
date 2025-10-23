---
title: core/BoundedBytes.ts
nav_order: 18
parent: Modules
---

## BoundedBytes overview

---

<h2 class="text-delta">Table of contents</h2>

- [schemas](#schemas)
  - [BoundedBytesSchema](#boundedbytesschema)

---

# schemas

## BoundedBytesSchema

BoundedBytes schema based on Conway CDDL specification

CDDL: bounded_bytes = bytes .size (0 .. 64)

The real bounded_bytes does not have this limit. it instead has
a different limit which cannot be expressed in CDDL.

The limit is as follows:

- bytes with a definite-length encoding are limited to size 0..64
- for bytes with an indefinite-length CBOR encoding, each chunk is
  limited to size 0..64
  ( reminder: in CBOR, the indefinite-length encoding of
  bytestrings consists of a token #2.31 followed by a sequence
  of definite-length encoded bytestrings and a stop code )

**Signature**

```ts
export declare const BoundedBytesSchema: Schema.filter<typeof Schema.Uint8ArrayFromSelf>
```

Added in v2.0.0
