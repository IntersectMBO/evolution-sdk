---
"@evolution-sdk/evolution": minor
---

Four measured behaviours in the Koios history tier, each of which a wallet hits on its first real account.

**`getAddressesSeen` batches by serialized bytes.** Koios refuses a request body over 5120 bytes with a 413 — measured: 48 mainnet base addresses come to 5104 and are served, 50 come to 5316 and are not. A gap-limit scan asks about more addresses than that in one call, so the single body failed at exactly the sizes this member exists for. It also asks `?select=address` now, which drops `utxo_set` from the response: the row wanted here is the address string alone, and the rest was the whole cost of the call.

**`getAccountTxs` can bound a window from above, and can order ascending.** `beforeBlock` is a PostgREST column filter rather than an RPC argument, and without it every window returns the newest rows above `afterBlock`, so a downward walk through an account's history never descends. `order: 'asc'` with `limit: 1` finds the account's oldest transaction in one call, rather than by descending into empty history to discover it is empty.

**`getAccountUtxos` takes `offset` and `limit`.** They bound the answer, not the work: spent rows are dropped after the walk, so a window asked of the backend would over- or under-fill.

**`getAccountAddresses` answers what it promises for a spent-down account.** Without Koios's `_empty` flag the endpoint reports only where a UTxO currently sits, so a registered, delegated account spent to zero enumerated to nothing — contradicting the member's own contract. With the flag, a real mainnet key holding value at four addresses and having derived ~490,000 answers 51,465,168 bytes (843 without), and `offset` cannot bound it because the addresses are nested inside one row per stake key. So the cheap question is asked first and the full enumeration is paid for only when it answers nothing. ⚠️ For a funded account the result is therefore the addresses holding value, not every address ever used; the member's documentation now says so, and points a caller tracking activity at the stake-keyed `getAccountUtxos` / `getAccountTxs` instead. The flat `{stake_address, address}` row shape some deployments answer with is now accepted alongside the nested one.
