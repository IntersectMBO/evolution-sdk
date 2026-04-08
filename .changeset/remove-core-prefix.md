---
"@evolution-sdk/evolution": patch
---

Remove unnecessary `Core` prefix from import aliases across the SDK.

Drops `Core` from 74+ import aliases (e.g. `CoreAddress` → `Address`, `CoreAssets` → `Assets`).
The prefix was unnecessary disambiguation — no file imported both a prefixed and bare version of the same module.

Renames local provider schema types that would shadow core modules:
- `Koios.UTxO` → `Koios.KoiosUTxO`
- `Kupo.UTxO` → `Kupo.KupoUTxO`
- `Kupo.Script` → `Kupo.KupoScript`
