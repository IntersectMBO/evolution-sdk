---
"@evolution-sdk/evolution": patch
---

`RewardAccount` parsing now validates the CIP-19 header type and the bech32 prefix, mirroring the checks `Address` already has. `FromBytes` (and therefore `FromHex`) rejects any header type other than 14 (stake key) or 15 (script), so a 29-byte enterprise or pointer address no longer parses as a reward account. `FromBech32` rejects prefixes other than `stake` / `stake_test` and rejects a prefix that disagrees with the network id in the header. Valid `stake` / `stake_test` accounts with key or script credentials round-trip unchanged.
