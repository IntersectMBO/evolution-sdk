---
"@evolution-sdk/evolution": patch
---

Export the redeemer types that the public transaction builder state refers to. `DeferredRedeemerData` in `TransactionBuilder` referenced `DeferredRedeemer`, which the build stripped as internal, so consumers type-checking the published declarations with `skipLibCheck: false` got TS2305, and with `skipLibCheck: true` the field silently became `any`. `StaticRedeemer`, `SelfRedeemer`, `BatchRedeemer` and `DeferredRedeemer` are now public types in `RedeemerBuilder`. CI now type-checks the built declaration files before a release.
