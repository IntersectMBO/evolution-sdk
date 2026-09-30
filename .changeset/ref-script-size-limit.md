---
"@evolution-sdk/evolution": patch
---

The transaction builder rejected reference scripts totalling more than 200,000 bytes. The Conway ledger allows up to 204,800 bytes (200 × 1024), so transactions between the two limits failed to build although the node accepts them. The builder now uses 204,800.
