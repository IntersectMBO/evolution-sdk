---
"@evolution-sdk/evolution": patch
---

Address parsing now validates the CIP-19 header type, not just the byte length. Previously `Address.fromHex` and `Address.fromBech32` chose between a base address and an enterprise address by length alone and never checked the header type nibble. A 29-byte reward (stake) address has the same length as an enterprise address, so it was accepted as an enterprise address with its stake credential silently used as the payment credential. `fromBech32` also ignored the bech32 prefix, so a `stake1...` string parsed as a payment address.

Parsing now requires header type 0–3 on the 57-byte base branch and 6–7 on the 29-byte enterprise branch, rejecting reward, pointer, Byron, and reserved types; the same check is applied in `BaseAddress.FromBytes` and `EnterpriseAddress.FromBytes`. `fromBech32` now requires an `addr`/`addr_test` prefix that agrees with the network in the header. Reward and stake addresses are handled by `RewardAccount`, not `Address`.
