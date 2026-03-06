---
"@evolution-sdk/aiken-uplc": patch
---

Fix Node.js ESM compatibility by switching WASM loading from CJS `--target nodejs` to ESM `--target web` with `initSync`.
