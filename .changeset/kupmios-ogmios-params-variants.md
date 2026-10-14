---
"@evolution-sdk/evolution": patch
---

The Kupmios provider's `getProtocolParameters` no longer fails against Ogmios servers whose protocol-parameter reply differs from the preprod shape it was written against. The Ogmios schema makes each `plutusCostModels` language optional — Ogmios builds that map from the cost models that exist on the network, so a language with no cost model is omitted entirely — and a missing language now maps to an empty cost model instead of failing the whole call (#568). The schema also accepts the Ogmios v7 spelling of the reference-script size limit: `maxReferenceScriptsSize` was renamed to `maxReferenceScriptsSizePerTransaction` (with a new `maxReferenceScriptsSizePerBlock` alongside), so all three keys are optional and either server generation decodes (#559).
