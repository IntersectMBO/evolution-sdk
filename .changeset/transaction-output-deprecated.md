---
"@evolution-sdk/evolution": patch
---

`TransactionOutput` is deprecated in favour of `TxOut`. It is a second, parallel model of a transaction output (`address: AddressEras`, `amount: Value`, a Shelley and a Babbage class) while `TxOut` carries the one `TransactionBody`, the builders and the sdk use (`address: Address`, `assets: Assets`, one class for both eras). Both are public under names that give no hint which is which, and they reject each other: an output built with `TransactionOutput` cannot go into a `TransactionBody`. Nothing is removed or re-pointed, so no caller breaks.

Every export of the module carries the tag, each naming its `TxOut` counterpart, since TypeScript cannot deprecate a namespace re-export and a tag on the module alone reaches no caller.
