---
"@evolution-sdk/evolution": minor
---

`NativeScripts.fromJSON` converts the cardano-cli JSON form back into a native script, and `NativeScripts.toJSON` no longer truncates a slot the JSON form cannot carry.

`toJSON` was declared `any` and converted `slot` and `required` with `Number(bigint)`. The cardano-cli form writes both as JSON numbers, so a CDDL uint64 above `Number.MAX_SAFE_INTEGER` came back as a different value with no error: `InvalidBefore(2n ** 53n)` and `InvalidBefore(2n ** 53n + 1n)` both produced `{ type: "after", slot: 9007199254740992 }`. A native script decoded from the chain may legitimately carry any uint64, so this was reachable on read and not only on authoring. `toJSON` now returns `NativeScriptJSON.NativeJSON` and throws for a value the form cannot represent exactly, rather than returning one that looks ordinary.

`fromJSON` is the inverse, and the direction the library did not have. Every node is built through the smart constructors, so `keyHash` is validated as a 28-byte hash instead of being taken on trust. The JSON form's slot names are the opposite way round from the CDDL's — `before` is `InvalidHereafter` and `after` is `InvalidBefore` — and `fromJSON` follows the JSON form.

`NativeScript[Hash.symbol]` no longer routes through `toJSON`. It hashed `JSON.stringify(toJSON(script))`, which inherited the truncation: the two scripts above hashed equal. With `toJSON` strict it would instead have thrown from inside a `HashSet`. It now hashes the variant itself with bigints stringified, so the hash number of every native script changes; `Equal` is implemented separately on the variant and decides membership, so this changes bucketing only.
