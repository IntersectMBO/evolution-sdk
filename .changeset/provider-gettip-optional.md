---
"@evolution-sdk/evolution": patch
---

`Provider.getTip` and `ProviderEffect.getTip` are optional.

Every provider in this package implements `getTip`, and the five shipped classes type their own `effect` field as the new `ProviderEffectWithTip` so they still call it directly. The interface is implemented outside this repository too, and a required member retires those implementations at a minor version — the reads added alongside `getTip` are all optional for the same reason.

A caller that needs the tip should check for it and report the absence, rather than the type system promising something a third-party backend never agreed to.
