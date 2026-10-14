---
"@evolution-sdk/evolution": patch
---

Transactions whose sets were decoded without tag 258 no longer gain the tag on re-encode. The captured format now decides whether the tag is written: when the format at a tag-258 position is an array node, the inner array is encoded with that node and the tag is omitted, so a plain round trip reproduces the input bytes exactly and the transaction id is unchanged. Witness sets holding Plutus data keep the untagged form too when a datum is added to an untagged datum set. With no captured format the tag is still written, so freshly built transactions do not change.
