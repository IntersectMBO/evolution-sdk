---
"@evolution-sdk/evolution": minor
---

`Koios` accepts a bearer token **or a function returning one**.

`new Koios(url, token)` captured the token once at construction, so a credential refreshed or re-issued while the provider lived was never picked up — the only remedy was to rebuild the provider, which a long-lived consumer has no natural moment to do.

`token` is now `string | (() => string | undefined)`. A function is resolved at each request; a plain string behaves exactly as before. The resolution happens where the header is built, so no call path changed: `TokenSource`, `resolveToken` and `authHeader` are exported from the Koios internals and the inline `Authorization` ternaries now route through the one helper.

A getter that currently returns `undefined` sends no `Authorization` header at all, rather than `Bearer undefined`.
