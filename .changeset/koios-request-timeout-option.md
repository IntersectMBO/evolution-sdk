---
"@evolution-sdk/evolution": minor
---

A Koios client's per-request timeout is a caller's choice, it is applied PER REQUEST rather than per operation, and the query tier has one at all for the first time.

`new Koios(baseUrl, token, { requestTimeoutMs })` sets the ceiling every read on that client races each of its requests against. `DEFAULT_REQUEST_TIMEOUT_MS` is exported from the provider module so a caller raising it can name what it is raising it from.

**Two defects this fixes, neither of them the configurability.**

⚠️ **The ceiling was around the operation, so it bounded a paged walk.** `getUtxos` over a *credential* reads `/credential_utxos`, which pages: a credential holding three pages of UTxOs spent one 10-second budget across three requests and was refused for being **large** rather than slow. The timeout now sits at the HTTP boundary, inside `pageAll`'s page function, so every page gets the full ceiling and a long walk is not cut off for being long.

⚠️ **The query tier had no timeout whatsoever.** The eleven `KoiosEffect` reads carried 10 s; the twenty-seven `KoiosQuery` reads — `getAccountUtxos`, `getUtxosByPaymentCredential(s)`, `getAccountTxs`, `getTxsAt`, `getTxInfo`, `getTxCbor`, the governance and pool reads — carried none, so they could hang on a stalled connection indefinitely. They are bounded now, which is a **behaviour change**: a read that previously waited forever fails as a `ProviderError` after the ceiling. For a wallet that is the better default — an unbounded read on a slow link is a sync that never finishes and never fails — but it is a new way for those reads to fail, and a consumer that relied on unbounded waits should set `requestTimeoutMs` high.

Ten seconds was written against a desktop on a fixed link. `/address_info` for a busy address measured 764 KB, which needs ~76 KB/s sustained to finish inside the window.

`awaitTx` now takes **both**: `timeoutMs` bounds each poll's request, its existing `timeout` argument bounds the whole wait across polls. They are not interchangeable — folding one into the other would either cap a confirmation wait at a single request's worth, reporting an unconfirmed transaction as a provider failure, or leave each poll able to hang for the entire wait.

`HttpUtils`'s new `timeoutMs` parameter is **optional with no default**, deliberately: that module is shared by Blockfrost, Maestro, Kupmios and Ogmios, and a default there would silently put a ceiling on four providers that never asked for one. Each opts in by threading its own value down; only Koios does today.
