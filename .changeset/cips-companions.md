---
"@evolution-sdk/cips": minor
---

New package: thirteen small CIP companions, built on the core types rather than beside them.

`Cip4` (wallet checksum), `Cip14` (the `asset1…` fingerprint), `Uri` (the `web+cardano:` scheme, CIP-13 plus 134 and 162), `Cip27` (royalty metadata), `Cip16` (key serialisation layouts and their CIP-5 prefixes), `Cip67` (the asset-name label registry), `Cip68` (datum metadata), `Cip88` (token policy registration, signed by the policy key), `GovMeta` (the off-chain governance document an anchor points at, CIP-100/108/119/136), `Cip102` (royalty datum), `Cip105` (Conway DRep / CC-cold / CC-hot key chains), `Cip129` (governance identifiers) and `Cip1855` (forging policy keys). The three CIPs still **proposed** say so in the module and in the README.

Each is driven by an oracle outside this library, not by its own output: `Cip4` against the `@emurgo/cip4-js` reference implementation, `Cip27` and `Cip88` against cardano-multiplatform-lib 6.2 for the metadata bytes and the policy-key signature, and `GovMeta` against coreutils `b2sum -l 256` for the anchor hash. `Cip4` also documents its one divergence from the reference: this strips a `0x` prefix and the reference does not, so the same key yields two different plates.

The CIP-13 grammar for the URI amount and delegation fields is `*digit [ "." *digit ]`, which `""` and `"."` satisfy. `web+cardano:addr1…?amount=` parsed to `{ amount: "" }` and `?amount=.` to `{ amount: "." }`; a consumer reading either gets `NaN`, and an empty amount is not the same fact as no amount at all. Both are a `UriError` now, and the digit forms the grammar allows (`10`, `0.5`, `1.`, `.5`) still parse.
