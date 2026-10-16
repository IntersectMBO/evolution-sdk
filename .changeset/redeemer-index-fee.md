---
"@evolution-sdk/evolution": patch
---

The builder now computes the fee with the redeemer indices the transaction is written with. Before, the fee estimate numbered redeemers 0, 1, 2 and so on, and a real index of 24 or more takes one more CBOR byte. A script transaction with two or more redeemers at index 24 or later, such as two script inputs that sort after 24 other inputs, paid too small a fee, and the node rejected it.

The fee changes only where a redeemer's index and its old number take a different number of bytes. Each redeemer at index 24 or more whose old number was under 24 adds the fee of one byte. With 25 or more redeemers, the reverse case removes one. Every other transaction keeps its bytes.
