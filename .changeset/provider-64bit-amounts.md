---
"@evolution-sdk/evolution": patch
---

Send exact 64-bit amounts in the Ogmios, Koios and Blockfrost `evaluateTx` requests. The additional UTxO amounts were converted through `Number()`, which rounds anything above 2^53-1 (#406, #455). The request bodies are now described with schemas whose amounts encode through `JSON.rawJSON` as exact unquoted integers. That needs Node 21+, Chrome 114, Firefox 135 or Safari 18.4; older runtimes fail such a request with a typed error instead of rounding. The `Provider` interface is unchanged. Inside `sdk/provider/internal`, the Ogmios `OgmiosAssets` and `OgmiosUTxO` types now carry `bigint` amounts.
