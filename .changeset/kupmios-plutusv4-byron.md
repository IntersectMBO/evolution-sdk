---
"@evolution-sdk/evolution": patch
---

The Kupmios provider now handles two Kupo responses it previously could not. `Kupo.ScriptSchema` accepts the `plutus:v4` language literal that Kupo v2.12 can return for `/scripts/{hash}`, and `getScript` fails with a `ProviderError` naming the language as not supported yet instead of the response being rejected as an opaque schema parse error (or, once the literal was accepted, a `throw` inside `Effect.map` surfacing as a defect). A UTxO whose address Kupo writes in Byron-era base58 likewise fails with a `ProviderError` explaining that Byron addresses are not supported, instead of the bech32 decode throwing inside `Effect.map` and surfacing as a defect callers cannot handle as a provider failure.
