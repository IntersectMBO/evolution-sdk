---
"@evolution-sdk/evolution": minor
---

The three remaining multi-id Koios bodies respect the 5120-byte limit — two by splitting, one by splitting and saying what it will not pretend to do.

`getTxInfo` and `getTxCbor` are chunked by serialized length. A transaction hash is 64 characters, so the limit arrives at about seventy-six of them, and a history hydrate asks about more. Their answers are keyed by hash and carry no order, so the chunks concatenate with nothing to reconcile.

`getTxsAt` is the interesting one, and two measurements decided its shape. A single multi-address request returns a transaction that touches two of the requested addresses **once**, so a split request must dedupe by hash or a split answer differs from an unsplit one by exactly the transactions that involve the wallet twice. And each chunk is newest-first only within itself, so the pages must be merged by block height — with a `limit`, concatenating returns the wrong rows rather than the right rows in the wrong order. Ties break on the transaction hash, which makes the merged order a function of chain state alone: without it the order follows the caller's address order, and a caller comparing "the newest transaction" against the last one it saw would watch it change while the chain did not.

Two requests it refuses instead of answering wrongly, both before spending a request:

- **an `offset` across a split.** A global window over several address streams is only knowable by reading the first `offset + limit` rows of every chunk, which makes a walk that steps the offset quadratic — and re-interpreting the offset per chunk would answer a different question than the caller asked. A caller paging deeply should split the addresses and page each stream, which is what a history walk wants anyway. One request's worth of addresses still honours every option exactly as before.
- **a `limit` above `MAX_ROWS_PER_RESPONSE` (1000).** Measured: `/address_txs` answers 1000 rows for `limit=1001` and for `limit=1500` alike, so the ceiling cannot be exceeded per chunk and the merge's correctness argument stops holding at the point the answer would be wrong. `getAccountTxs` refuses the same thing for the same reason: a truncated answer reads exactly like a complete one.
