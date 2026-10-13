# @evolution-sdk/cips

Thirteen small Cardano CIP companions: wallet checksums, asset fingerprints, asset-name labels,
datum metadata, royalties, token policy registration, URIs, governance metadata and identifiers,
Conway and forging-policy key chains, and key serialisation.

| module | CIP | what it is |
|---|---|---|
| `Cip4` | 4 | the wallet checksum: a short, human-comparable fingerprint of an account key |
| `Cip14` | 14 | the user-facing asset fingerprint, `asset1…` |
| `Uri` | 13 (+134, 162) | the `web+cardano:` URI scheme — payments, delegation, addresses, DReps |
| `Cip27` | 27 | the royalty metadata entry, label 777 |
| `Cip16` | 16 | key serialisation — the `vk`/`sk`/`xvk`/`xsk` layouts and their CIP-5 prefixes |
| `Cip67` | 67 | the asset-name label registry, in bytes |
| `Cip68` | 68 | the datum metadata standard |
| `Cip88` | 88 | token policy registration, label 867, signed by the policy key |
| `GovMeta` | 100 / 108 / 119 / 136 | the off-chain governance metadata document an anchor points at |
| `Cip102` | 102 | the royalty datum (**proposed**) |
| `Cip105` | 105 | Conway-era key chains — DRep, CC-cold, CC-hot |
| `Cip129` | 129 | governance identifiers (**proposed**) |
| `Cip1855` | 1855 | forging policy keys (**proposed**) |

## Built on the core, not beside it

The CIP-67 label arithmetic is `@evolution-sdk/evolution`'s `Label`, not a second copy — the two
were compared over **all 65,536 labels in both directions** before this package was written. What
`Cip67` adds is the byte-oriented surface CIP-68 and CIP-102 need, since `Label` speaks hex and an
`asset_name` is bytes. CIP-68 and CIP-102 build Evolution `Data` values; bech32 is Evolution's.

## What it refuses

These are identifier and key formats, so most of the value is in what they decline.

**A prefix is part of the identity.** `Bech32.FromBytes(prefix)` applies its prefix only when
encoding — decoding accepts any prefix and returns the payload, so a `drep1…` string decodes
cleanly under `FromBytes("asset")`. This package checks the prefix in both directions, because a
`cc_cold` id read as a `drep` is a credential of the wrong kind.

**A CIP-129 id whose prefix and header byte disagree is neither kind.** Both state the key type;
a value where they differ is refused rather than read as either.

**A key of the wrong length is refused.** It would otherwise encode to a perfectly valid bech32
string of the wrong kind, which travels a long way before anything notices.

**An unlabelled asset name is unlabelled, not an error.** `Cip67.fromLabel` returns `undefined`
for a name that carries no CIP-67 label, because that is the common case and not a failure.

**`Cip4` is a typo check, not a security boundary.** It is short by design; two different keys can
collide, and nothing here should be read as a proof of identity.

**`Cip27` and `Cip88` write metadata that is hashed into the transaction.** It reaches
`auxiliary_data_hash`, and a hardware wallet re-serialises what it is shown, so map key order is
part of the value: `Cip27` writes its keys in canonical order, and `Cip88`'s are ascending
integers, which already is canonical. `Cip88`'s payload is additionally the signing preimage, so a
byte that moves invalidates every witness over it.

**`GovMeta` hashes the document bytes as given.** CIP-100 specifies RDF-Dataset canonicalisation
(URDNA2015) over the JSON-LD, which needs a full JSON-LD stack; author witnesses are therefore not
built here. The anchor hash itself is over the raw bytes, which is what the anchor commits to.

**A URI is untrusted input.** `Uri.parse` reports what it cannot read rather than guessing, and
covers standard CIP-13 only — no vendor deep-link extensions. An `amount` or `proportion` with no
digit in it is one of those: `?amount=` and `?amount=.` both satisfy the CIP-13 grammar and
neither is a number, so they are refused rather than read as zero.

```ts
import { Cip14, Cip67, Cip68, Cip129 } from "@evolution-sdk/cips"

Cip14.assetFingerprint(policyId, assetName)   // "asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3"
Cip67.fromLabel(assetName)                     // 222 | undefined
Cip68.referenceNftName(content)                // the (100) name paired with the (222) user token
Cip129.parseCredential("drep1…")               // { keyType, isScript, hash } | undefined
```
