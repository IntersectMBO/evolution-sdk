---
"@evolution-sdk/evolution": minor
---

A transaction, body, witness set or auxiliary data can be assembled from parts that are already encoded.

`Transaction.fromEncoded`, `TransactionBody.fromEncoded`, `TransactionWitnessSet.fromEncoded` and `AuxiliaryData.fromEncoded` take the bytes of each part and frame them, rather than taking values and encoding them. A caller that holds a body it must not re-encode — because its hash is already committed to, or because a signer displayed exactly those bytes — can now assemble around it.

`Redeemers.keepDataBytes`, `Redeemers.spliceMap` and `Redeemers.toScriptDataHashFromEncoded` are the same idea for the script-data hash: the hash is taken over the bytes as they arrived, not over a re-encode that happens to look equivalent.

`Transaction.cborHeaderSize` reports the header width at an offset, which is what makes a part addressable: a caller slicing one element out of an array needs to know where the element starts, and a re-encode cannot promise the same bytes.

`Transaction.setIntendedCodecOptions` / `getIntendedCodecOptions` record which options a transaction is meant to be encoded under, so a builder's choice reaches the hash computations taken during the build instead of each one defaulting independently.

`TransactionBody` also gains the `WithFormat` pair (`fromCBORBytesWithFormat`, `fromCBORHexWithFormat`, `toCBORBytesWithFormat`, `toCBORHexWithFormat`) that the other codecs in this package already have, plus `toCBORBytes` taking `CodecOptions`.
