---
"@evolution-sdk/evolution": minor
---

`TransactionHash`, `Bip32PublicKey` and `Bip32PrivateKey` carry a branded, validated hex type, and `toHex` returns it.

The hex boundary discarded what a value was. `BytesFromHex` is `Schema.Uint8ArrayFromHex` plus a length filter, so `TransactionHash.toHex()` handed back a bare `string` and from that point a transaction hash, a datum hash and a key were interchangeable — the type system had nothing left to object to.

Each of the three now exports a `Hex` schema built the way `PaymentAddress`, `RewardAddress` and `DnsName` already are: `Schema.String` with a pattern, branded. `toHex` returns it, so the kind survives leaving the typed domain, and `Hex.make` *checks* the claim rather than asserting it.

The extended key pair is the reason this is worth doing beyond tidiness. A 64-byte extended public key and a 96-byte extended private key are both "hex", and confusing them is unrecoverable in one direction: publishing where a private key was expected is merely wrong, while signing with what you believed was public is a leaked key. They now have different brands and different lengths, so the swap is refused twice over.

Additive: `fromHex` still accepts a plain `string`, so no caller has to change.

The same treatment now covers `KeyHash`, `PolicyId`, `AssetName`, `DatumHash`, `ScriptDataHash`, `AuxiliaryDataHash`, `VKey`, `Ed25519Signature`, `Address` (hex *and* bech32, branded apart from each other), and the CBOR-hex forms of `Value`, `Script` and `Data`.

Two of these exist for a specific confusion rather than for symmetry. `VKey.Hex` is the 32-byte verification key, not the 64-byte extended form a verifier would fail on. `Ed25519Signature.Hex` is branded apart from it because a `vkeywitness` holds exactly those two in that order, and transposing them yields a witness that is structurally valid and verifies against nothing. `AssetName.Hex` admits the empty string deliberately: a policy's unnamed asset is spelled exactly that way.

The *shaped* brands — hashes, keys, addresses — validate on construction. The *opaque* ones (`Value`, `Script`, `Data` CBOR hex) stay casts: the only check available for arbitrary-length CBOR is "even number of hex digits", which rejects almost nothing real while breaking test doubles that carry a readable stand-in rather than a genuine encoding.
