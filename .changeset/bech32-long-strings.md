---
"@evolution-sdk/evolution": patch
---

`Bech32.FromBytes` failed on strings longer than 90 characters, such as base addresses, when `@scure/base` 2.4 or later was installed. That version made `bech32.decodeToBytes` enforce the 90-character BIP-173 limit by default, and the SDK called it without a limit. It now passes no limit, as every other bech32 decode in the SDK already does.
