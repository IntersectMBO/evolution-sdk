---
"@evolution-sdk/evolution": minor
---

A BIP-39 passphrase is bytes, CIP-1854 and the DRep role are expressible, and a public key can be derived along a path.

`Bip32PrivateKey.fromBip39Entropy` took a `string` only, so a caller holding raw passphrase bytes had to decode them as UTF-8 first. Bytes that are not valid UTF-8 do not survive that: they decode to U+FFFD, and the key derived from the mangled passphrase is a different key — a different wallet, with nothing anywhere to say so. It now takes `Uint8Array | string`, and the two agree whenever the text is the bytes.

`CardanoPath.indices` hardcoded purpose 1852 and typed `role` as `0 | 2`, so neither CIP-1854 (shared wallets) nor role 3 (DRep) could be expressed. `PURPOSE_CIP1852` and `PURPOSE_CIP1854` are exported and the role is open.

`Bip32PublicKey.derivePath` is the path form of the single-step `deriveChild` it already had. Deriving addresses from a co-signer's account xpub — no seed, no signing ceremony — needs exactly that.

`AddressTag` reads an address's parts straight from its bytes: `fromHeader`, `fromBytes`, `networkId`, `paymentCredential` and `stakeCredential`, each answering `undefined` rather than guessing when the header says the address has no such part.
