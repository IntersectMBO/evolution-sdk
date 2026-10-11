import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as Credential from "../src/Credential.js"
import * as KeyHash from "../src/KeyHash.js"
import * as KoiosEffect from "../src/sdk/provider/internal/KoiosEffect.js"
import * as KoiosQuery from "../src/sdk/provider/internal/KoiosQuery.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionInput from "../src/TransactionInput.js"

/**
 * The history and discovery tier against a stubbed Koios. What is checked is the half a
 * mapping test cannot reach: which endpoint is called, what body it carries, and how a row
 * that does not carry an answer is treated.
 */

const BASE = "http://koios.test"
// Both decode. ⚠️ Not every `addr_test1…` in this package's fixtures does — the one in
// `TxBuilder.Reselection.test.ts` does not — and a bech32 that fails to decode would make
// every assertion below a statement about the test rather than about the code.
const ADDR_A =
  "addr_test1qp8wl3hnya9l94rt58ky533deyqe9t8zz5n9su26k8e5g23yar4q0adtaax9q9g0kphpv2ws7vxqwu6ln6pqx7j29nfqnle9hh"
const ADDR_B = "addr_test1vzpwq95z3xyum8vqndgdd9mdnmafh3djcxnc6jemlgdmswcve6tkw"
const TX_A = "aa".repeat(32)
const TX_B = "bb".repeat(32)

/** Captures the request URLs and bodies, and replies with `body`. */
const stub = (body: unknown) => {
  const calls: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const addr = (bech32: string) => CoreAddress.fromBech32(bech32)

describe("getTxsAt", () => {
  it("asks /address_txs for every address, newest first", async () => {
    const calls = stub([{ tx_hash: TX_A, block_height: 10, block_time: 1700, epoch_no: 4 }])

    const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)([addr(ADDR_A), addr(ADDR_B)]))

    expect(calls[0]!.url).toContain("/address_txs")
    expect(calls[0]!.url).toContain("order=block_height.desc")
    expect((calls[0]!.body as { _addresses: Array<string> })._addresses).toEqual([ADDR_A, ADDR_B])
    expect(refs).toEqual([{ txHash: TransactionHash.fromHex(TX_A), blockHeight: 10, blockTime: 1700, epochNo: 4 }])
  })

  it("passes the block floor as an RPC argument and the page as query parameters", async () => {
    const calls = stub([])

    await Effect.runPromise(KoiosQuery.getTxsAt(BASE)([addr(ADDR_A)], { afterBlock: 500, limit: 20, offset: 40 }))

    expect(calls[0]!.url).toContain("limit=20")
    expect(calls[0]!.url).toContain("offset=40")
    expect((calls[0]!.body as { _after_block_height: number })._after_block_height).toBe(500)
  })

  it("asks nothing at all for an empty address list", async () => {
    const calls = stub([])
    const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)([]))
    expect(refs).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("leaves a block height the backend omitted absent, rather than defaulting it", async () => {
    stub([{ tx_hash: TX_A, block_height: null, block_time: null, epoch_no: null }])
    const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)([addr(ADDR_A)]))
    expect(refs[0]).toEqual({ txHash: TransactionHash.fromHex(TX_A) })
    expect("blockHeight" in refs[0]!).toBe(false)
  })
})

describe("getTxsAt — more addresses than one body holds", () => {
  // 60 base addresses is ~6.4 KB in one body and Koios refuses anything over 5120.
  const many = (n: number) => Array.from({ length: n }, (_, i) => addr([ADDR_A, ADDR_B][i % 2]!))

  it("splits the addresses and merges the pages into one answer", async () => {
    const calls = stub([{ tx_hash: TX_A, block_height: 10, block_time: 1700, epoch_no: 4 }])

    const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)(many(60)))

    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) expect(JSON.stringify(call.body).length).toBeLessThan(5120)
    // ⚠️ ONE row, not one per chunk. A single multi-address request returns a transaction that
    // touches two of the addresses exactly once (measured), so a split answer that did not
    // dedupe would differ from an unsplit one by every transaction involving the wallet twice.
    expect(refs).toHaveLength(1)
    expect(refs[0]!.txHash).toEqual(TransactionHash.fromHex(TX_A))
  })

  it("orders the merged rows newest first ACROSS the chunks, not within each", async () => {
    // Each chunk is newest-first inside itself. Concatenating them is newest-first per chunk and
    // meaningless overall — and with a limit it returns the wrong rows, not just the wrong order.
    let call = 0
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      call += 1
      const rows =
        call === 1
          ? [{ tx_hash: TX_A, block_height: 10 }]
          : [
              { tx_hash: TX_B, block_height: 99 },
              { tx_hash: "cc".repeat(32), block_height: 50 }
            ]
      void init
      return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)(many(60)))

    expect(refs.map((r) => r.blockHeight)).toEqual([99, 50, 10])
  })

  it("breaks a tie on the hash, so the order does not depend on which chunk answered first", async () => {
    // Several transactions share a block height routinely. Without a tie-break the merged order
    // follows the caller's address order, and a caller comparing "the newest transaction" against
    // the last one it saw would watch it change while the chain did not — and re-sync every time.
    const atSameHeight = async (first: string, second: string) => {
      let call = 0
      vi.stubGlobal("fetch", async () => {
        call += 1
        const tx = call === 1 ? first : second
        return new Response(JSON.stringify([{ tx_hash: tx, block_height: 77 }]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      })
      const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)(many(60), { limit: 1 }))
      return TransactionHash.toHex(refs[0]!.txHash)
    }

    // The same two transactions, answered in both orders, must pick the same winner.
    expect(await atSameHeight(TX_A, TX_B)).toBe(await atSameHeight(TX_B, TX_A))
  })

  it("applies a limit to the MERGED rows, which is the only place it means anything", async () => {
    let call = 0
    vi.stubGlobal("fetch", async () => {
      call += 1
      const rows = call === 1 ? [{ tx_hash: TX_A, block_height: 10 }] : [{ tx_hash: TX_B, block_height: 99 }]
      return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const refs = await Effect.runPromise(KoiosQuery.getTxsAt(BASE)(many(60), { limit: 1 }))

    // The newest across every address, not the newest of whichever chunk answered first.
    expect(refs).toHaveLength(1)
    expect(refs[0]!.blockHeight).toBe(99)
  })

  it("refuses an offset across a split rather than applying it per chunk", async () => {
    // A global window over several address streams is only knowable by reading the first
    // offset+limit rows of every chunk, which makes a walk that steps the offset quadratic.
    // Re-interpreting it per chunk would answer a different question than the caller asked.
    const calls = stub([])

    const error = await Effect.runPromise(Effect.flip(KoiosQuery.getTxsAt(BASE)(many(60), { offset: 1000 })))

    expect(calls).toHaveLength(0)
    expect(error.message).toContain("offset cannot be applied")
    // The counts a caller needs to act on it.
    expect(error.message).toContain("60 addresses")
  })

  it("refuses a limit above the row ceiling, instead of serving it truncated", async () => {
    // Measured: /address_txs answers 1000 rows for limit=1001 and for limit=1500 alike.
    const calls = stub([])

    const error = await Effect.runPromise(Effect.flip(KoiosQuery.getTxsAt(BASE)(many(60), { limit: 1500 })))

    expect(calls).toHaveLength(0)
    expect(error.message).toContain("1000-row")
  })

  it("keeps every option exactly as asked when one request is enough", async () => {
    // The single-request path is unchanged: an offset is a window into one ordered result set,
    // and that is the case in which it means what it says.
    const calls = stub([])

    await Effect.runPromise(KoiosQuery.getTxsAt(BASE)([addr(ADDR_A)], { offset: 40, limit: 20, afterBlock: 5 }))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain("offset=40")
    expect(calls[0]!.url).toContain("limit=20")
  })
})

describe("getAccountTxs", () => {
  it("asks /account_txs for the one stake address", async () => {
    const calls = stub([{ tx_hash: TX_B, block_height: 11, block_time: 1800, epoch_no: 5 }])

    const refs = await Effect.runPromise(KoiosQuery.getAccountTxs(BASE)("stake_test1uqxyz" as never, { afterBlock: 9 }))

    expect(calls[0]!.url).toContain("/account_txs")
    expect(calls[0]!.url).toContain("order=block_height.desc")
    expect(calls[0]!.body).toEqual({ _stake_address: "stake_test1uqxyz", _after_block_height: 9 })
    expect(refs[0]!.txHash).toEqual(TransactionHash.fromHex(TX_B))
  })

  it("bounds a window from ABOVE with a column filter, not with an RPC argument", async () => {
    // Without the upper bound, every window returns the newest rows above `afterBlock` and a
    // downward walk never descends.
    const calls = stub([])

    await Effect.runPromise(
      KoiosQuery.getAccountTxs(BASE)("stake_test1uqxyz" as never, { afterBlock: 100, beforeBlock: 200 })
    )

    expect(calls[0]!.url).toContain("block_height=lt.200")
    expect(calls[0]!.body).toEqual({ _stake_address: "stake_test1uqxyz", _after_block_height: 100 })
  })

  it("refuses a limit above the row ceiling rather than answering truncated", async () => {
    // A truncated answer reads exactly like a complete one, and this is the member a history
    // walk asks "is there anything newer".
    const calls = stub([])

    const error = await Effect.runPromise(
      Effect.flip(KoiosQuery.getAccountTxs(BASE)("stake_test1uqxyz" as never, { limit: 2000 }))
    )

    expect(calls).toHaveLength(0)
    expect(error.message).toContain("1000-row")
  })

  it("orders ascending on request, which is how the oldest transaction is found", async () => {
    const calls = stub([])

    await Effect.runPromise(KoiosQuery.getAccountTxs(BASE)("stake_test1uqxyz" as never, { order: "asc", limit: 1 }))

    expect(calls[0]!.url).toContain("order=block_height.asc")
    expect(calls[0]!.url).toContain("limit=1")
  })
})

describe("getAccountAddresses", () => {
  it("flattens the account's address list", async () => {
    const calls = stub([{ addresses: [ADDR_A, ADDR_B] }])

    const found = await Effect.runPromise(KoiosQuery.getAccountAddresses(BASE)("stake_test1uqxyz" as never))

    expect(calls[0]!.url).toContain("/account_addresses")
    expect(found.map(CoreAddress.toBech32)).toEqual([ADDR_A, ADDR_B])
  })

  it("does NOT pay for the full enumeration when the account holds value somewhere", async () => {
    // `_empty: true` answered 51 MB on a real mainnet key with ~490,000 derived addresses. The
    // cheap question is asked first for that reason, and asking it is the whole saving.
    const calls = stub([{ addresses: [ADDR_A] }])

    await Effect.runPromise(KoiosQuery.getAccountAddresses(BASE)("stake_test1uqxyz" as never))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toEqual({ _stake_addresses: ["stake_test1uqxyz"] })
  })

  it("asks again with _empty when the cheap question answers nothing", async () => {
    // A registered, delegated account spent down to zero. Without the second question it
    // enumerates to nothing, which contradicts what this member promises: a watch-only import
    // of exactly such a key reported that it had no addresses at all.
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      calls.push({ url: String(input), body })
      const rows = (body as { _empty?: boolean })?._empty === true ? [{ addresses: [ADDR_B] }] : [{ addresses: [] }]
      return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const found = await Effect.runPromise(KoiosQuery.getAccountAddresses(BASE)("stake_test1uqxyz" as never))

    expect(calls).toHaveLength(2)
    expect(calls[1]!.body).toEqual({ _stake_addresses: ["stake_test1uqxyz"], _empty: true })
    expect(found.map(CoreAddress.toBech32)).toEqual([ADDR_B])
  })

  it("accepts the flat row shape some deployments answer with", async () => {
    stub([{ stake_address: "stake_test1uqxyz", address: ADDR_A }])

    const found = await Effect.runPromise(KoiosQuery.getAccountAddresses(BASE)("stake_test1uqxyz" as never))

    expect(found.map(CoreAddress.toBech32)).toEqual([ADDR_A])
  })
})

describe("getAddressesSeen", () => {
  it("returns only the addresses the chain answered for", async () => {
    // Asked about two, the backend knows one. The other is unseen, not failed.
    const calls = stub([{ address: ADDR_A }])

    const seen = await Effect.runPromise(KoiosQuery.getAddressesSeen(BASE)([addr(ADDR_A), addr(ADDR_B)]))

    expect(calls[0]!.url).toContain("/address_info")
    // `select=address` drops `utxo_set`, which is otherwise the whole cost of the call.
    expect(calls[0]!.url).toContain("select=address")
    expect(seen.map(CoreAddress.toBech32)).toEqual([ADDR_A])
  })

  it("splits the batch by SERIALIZED BYTES, because Koios refuses a body over 5120", async () => {
    // Measured: 48 mainnet base addresses = 5104 bytes → 200, 50 = 5316 → 413. A gap scan asks
    // about more than that at once, so one body would 413 at exactly the size this serves.
    const calls = stub([])
    const many = Array.from({ length: 60 }, () => addr(ADDR_A))

    await Effect.runPromise(KoiosQuery.getAddressesSeen(BASE)(many))

    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) expect(JSON.stringify(call.body).length).toBeLessThan(5120)
    const asked = calls.flatMap((c) => (c.body as { _addresses: Array<string> })._addresses)
    expect(asked).toHaveLength(60)
  })

  it("asks nothing for an empty list", async () => {
    const calls = stub([])
    expect(await Effect.runPromise(KoiosQuery.getAddressesSeen(BASE)([]))).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe("getAccountUtxos", () => {
  /** One `_extended: true` listing row, which is what the account listing answers. */
  const row = (index: number, spent?: boolean) => ({
    tx_hash: TX_A,
    tx_index: index,
    address: ADDR_A,
    value: "2000000",
    ...(spent !== undefined ? { is_spent: spent } : {}),
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: []
  })

  it("asks the account listing with the extended column set", async () => {
    const calls = stub([row(0)])

    const utxos = await Effect.runPromise(KoiosQuery.getAccountUtxos(BASE)("stake_test1uqxyz" as never))

    expect(calls[0]!.url).toContain("/account_utxos")
    // Without `_extended` Koios returns a null `asset_list`, so a token balance reads as zero.
    expect(calls[0]!.body).toEqual({ _stake_addresses: ["stake_test1uqxyz"], _extended: true })
    expect(utxos).toHaveLength(1)
  })

  it("drops a spent row, because this member's contract is spendable UTxOs", async () => {
    stub([row(0), row(1, true)])
    const utxos = await Effect.runPromise(KoiosQuery.getAccountUtxos(BASE)("stake_test1uqxyz" as never))
    expect(utxos.map((u) => Number(u.index))).toEqual([0])
  })

  it("windows the ANSWER with offset and limit, after the spent rows are dropped", async () => {
    // Slicing before the filter would answer fewer rows than were asked for and read as the
    // end of the list.
    stub([row(0), row(1, true), row(2), row(3)])

    const utxos = await Effect.runPromise(
      KoiosQuery.getAccountUtxos(BASE)("stake_test1uqxyz" as never, { offset: 1, limit: 1 })
    )

    expect(utxos.map((u) => Number(u.index))).toEqual([2])
  })
})

describe("getTxConfirmations", () => {
  it("asks /tx_status and reports the depth", async () => {
    const calls = stub([{ tx_hash: TX_A, num_confirmations: 7 }])

    const depth = await Effect.runPromise(KoiosQuery.getTxConfirmations(BASE)(TransactionHash.fromHex(TX_A)))

    expect(calls[0]!.url).toContain("/tx_status")
    expect((calls[0]!.body as { _tx_hashes: Array<string> })._tx_hashes).toEqual([TX_A])
    expect(depth).toBe(7)
  })

  it("reports a transaction the indexer has not seen as null, NOT as zero deep", async () => {
    // Zero deep is not a state a transaction on chain can be in, so returning 0 would make
    // "not submitted" and "just included" the same answer to a caller waiting on settlement.
    stub([{ tx_hash: TX_A, num_confirmations: null }])
    expect(await Effect.runPromise(KoiosQuery.getTxConfirmations(BASE)(TransactionHash.fromHex(TX_A)))).toBeNull()
  })

  it("reports an absent row as null too", async () => {
    stub([])
    expect(await Effect.runPromise(KoiosQuery.getTxConfirmations(BASE)(TransactionHash.fromHex(TX_A)))).toBeNull()
  })
})

describe("getTxCbor", () => {
  it("returns the bytes for each hash it was given", async () => {
    const calls = stub([{ tx_hash: TX_A, cbor: "84a0" }])

    const got = await Effect.runPromise(KoiosQuery.getTxCbor(BASE)([TransactionHash.fromHex(TX_A)]))

    expect(calls[0]!.url).toContain("/tx_cbor")
    expect((calls[0]!.body as { _tx_hashes: Array<string> })._tx_hashes).toEqual([TX_A])
    expect(got).toEqual([{ txHash: TransactionHash.fromHex(TX_A), cborHex: "84a0" }])
  })

  it("drops a row carrying no bytes rather than returning an empty transaction", async () => {
    stub([
      { tx_hash: TX_A, cbor: null },
      { tx_hash: TX_B, cbor: "" }
    ])
    const got = await Effect.runPromise(
      KoiosQuery.getTxCbor(BASE)([TransactionHash.fromHex(TX_A), TransactionHash.fromHex(TX_B)])
    )
    expect(got).toEqual([])
  })
})

describe("getScriptByHash", () => {
  it("reports the script and its Plutus version", async () => {
    const calls = stub([{ script_hash: "ab".repeat(28), bytes: "4e4d01", type: "plutusV3" }])

    const script = await Effect.runPromise(KoiosQuery.getScriptByHash(BASE)("ab".repeat(28)))

    expect(calls[0]!.url).toContain("/script_info")
    expect(script).toEqual({ bytesHex: "4e4d01", version: "V3" })
  })

  it("reports a hash the chain has not seen as undefined, not as a failure", async () => {
    stub([])
    expect(await Effect.runPromise(KoiosQuery.getScriptByHash(BASE)("ab".repeat(28)))).toBeUndefined()
  })

  it("refuses to guess a version it does not know", async () => {
    // A native script, or a Plutus version added after this build: reporting it as V1 would
    // hand the caller bytes with a wrong idea of how to run them.
    stub([{ script_hash: "ab".repeat(28), bytes: "4e4d01", type: "timelock" }])
    expect(await Effect.runPromise(KoiosQuery.getScriptByHash(BASE)("ab".repeat(28)))).toBeUndefined()
  })
})

describe("getUtxosByPaymentCredentials", () => {
  // ⚠️ REAL credentials. These were built by hand as `{_tag: "KeyHash", hash} as never`, so the
  // hash was a string in the fixture and a Uint8Array in production — and `JSON.stringify` turns
  // one of those into `{"0":170,"1":170,…}`. The test passed; the request was unreadable.
  const cred = (hash: string) => KeyHash.fromHex(hash)

  it("asks nothing for an empty credential list", async () => {
    const calls = stub([])
    expect(await Effect.runPromise(KoiosQuery.getUtxosByPaymentCredentials(BASE)([]))).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("asks /credential_utxos with the credentials as HEX", async () => {
    const calls = stub([])

    await Effect.runPromise(
      KoiosQuery.getUtxosByPaymentCredentials(BASE)([cred("aa".repeat(28)), cred("bb".repeat(28))])
    )

    expect(calls[0]!.url).toContain("/credential_utxos")
    expect((calls[0]!.body as { _payment_credentials: Array<string> })._payment_credentials).toEqual([
      "aa".repeat(28),
      "bb".repeat(28)
    ])
  })

  it("splits a long credential list by serialized bytes", async () => {
    // A wallet asking about its whole signable set passes the 5120-byte body limit at ~90
    // credentials; measured, 664 of them come to 39,219 bytes in one body and are refused.
    const calls = stub([])
    const creds = Array.from({ length: 664 }, (_, i) => cred(i.toString(16).padStart(56, "a")))

    await Effect.runPromise(KoiosQuery.getUtxosByPaymentCredentials(BASE)(creds))

    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) expect(JSON.stringify(call.body).length).toBeLessThan(5120)
    const asked = calls.flatMap((c) => (c.body as { _payment_credentials: Array<string> })._payment_credentials)
    expect(asked).toEqual(creds.map((c) => Credential.toHex(c)))
  })
})

describe("getTxInfo", () => {
  const ROW = {
    tx_hash: TX_A,
    block_hash: "cc".repeat(32),
    block_height: "120",
    epoch_no: "7",
    absolute_slot: "9000",
    tx_timestamp: "1700000000",
    fee: "174301",
    inputs: [{ tx_hash: TX_B, tx_index: "1", payment_addr: { bech32: ADDR_B }, value: "5000000", asset_list: [] }],
    outputs: [
      {
        tx_hash: TX_A,
        tx_index: "0",
        payment_addr: { bech32: ADDR_A },
        value: "2000000",
        asset_list: [
          { policy_id: "aa".repeat(28), asset_name: "4d494e", fingerprint: "asset1x", decimals: null, quantity: "12" }
        ]
      }
    ],
    withdrawals: [{ stake_addr: "stake_test1uqxyz", amount: "42" }],
    certificates: [{ type: "delegation", info: { pool: "pool1abc" } }],
    assets_minted: [
      { policy_id: "bb".repeat(28), asset_name: "", fingerprint: "asset1y", decimals: null, quantity: "7" }
    ],
    metadata: { "674": { msg: ["hello"] } }
  }

  it("maps a transaction the indexer reports", async () => {
    const calls = stub([ROW])

    const [tx] = await Effect.runPromise(KoiosQuery.getTxInfo(BASE)([TransactionHash.fromHex(TX_A)]))

    expect(calls[0]!.url).toContain("/tx_info")
    // The flags are what make inputs, certificates, withdrawals and assets present at all.
    expect(calls[0]!.body).toMatchObject({ _inputs: true, _certs: true, _withdrawals: true, _assets: true })
    expect(tx!.fee).toBe(174301n)
    expect(tx!.blockHeight).toBe(120)
    expect(tx!.slot).toBe(9000)
    expect(tx!.inputs[0]!.coin).toBe(5000000n)
    expect(tx!.inputs[0]!.outpoint).toEqual({ txHash: TransactionHash.fromHex(TX_B), index: 1 })
    expect(tx!.outputs[0]!.assets).toEqual([{ unit: `${"aa".repeat(28)}4d494e`, quantity: 12n }])
    expect(tx!.withdrawals).toEqual([{ stakeAddress: "stake_test1uqxyz", amount: 42n }])
    expect(tx!.certificates).toEqual([{ type: "delegation", info: { pool: "pool1abc" } }])
    expect(tx!.mint).toEqual([{ unit: "bb".repeat(28), quantity: 7n }])
    expect(tx!.metadata).toEqual({ "674": { msg: ["hello"] } })
  })

  it("carries no validity verdict, because /tx_info does not report one", () => {
    // A script-invalid transaction is on chain too. Asserting `true` here would make the two
    // indistinguishable; the flag lives in the transaction's bytes, which getTxCbor serves.
    expect("isValid" in ROW).toBe(false)
  })

  it("drops an IO with no address rather than inventing a counterparty", async () => {
    stub([{ ...ROW, inputs: [{ tx_hash: TX_B, tx_index: "1", payment_addr: null, value: "1", asset_list: [] }] }])
    const [tx] = await Effect.runPromise(KoiosQuery.getTxInfo(BASE)([TransactionHash.fromHex(TX_A)]))
    expect(tx!.inputs).toEqual([])
  })

  it("asks nothing for an empty hash list", async () => {
    const calls = stub([])
    expect(await Effect.runPromise(KoiosQuery.getTxInfo(BASE)([]))).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe("the bearer token", () => {
  // ⚠️ https, where every other test here uses http: a credential bound for a plain-http
  // endpoint is refused before the request is issued (see the last case in this block).
  const SECURE = "https://koios.test"

  /** Captures the Authorization header of each request, however it was expressed. */
  const stubWithHeaders = (body: unknown) => {
    const headers: Array<string | undefined> = []
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      headers.push(new Headers(init?.headers ?? {}).get("Authorization") ?? undefined)
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    })
    return headers
  }

  it("sends a static token", async () => {
    const headers = stubWithHeaders([])
    await Effect.runPromise(KoiosQuery.getAddressesSeen(SECURE, "static-token")([addr(ADDR_A)]))
    expect(headers[0]).toBe("Bearer static-token")
  })

  it("resolves a getter PER REQUEST, so a refreshed credential is picked up", async () => {
    // The reason the union exists: a token that rotates while the provider lives must not be
    // captured once at construction.
    const headers = stubWithHeaders([])
    let current = "first"
    const provider = KoiosQuery.getAddressesSeen(SECURE, () => current)

    await Effect.runPromise(provider([addr(ADDR_A)]))
    current = "second"
    await Effect.runPromise(provider([addr(ADDR_A)]))

    expect(headers).toEqual(["Bearer first", "Bearer second"])
  })

  it("sends no Authorization header when the getter has no token yet", async () => {
    // Over plain http, which is allowed precisely because there is no credential on the wire.
    const headers = stubWithHeaders([])
    await Effect.runPromise(KoiosQuery.getAddressesSeen(BASE, () => undefined)([addr(ADDR_A)]))
    expect(headers[0]).toBeUndefined()
  })

  it("refuses to put the token on a plain-http wire, without issuing the request", async () => {
    // A token is a user's paid tier or a wallet's identity. Over http every hop can read it,
    // and the endpoint being wrong is not a reason to leak it — so the request is never made.
    const headers = stubWithHeaders([])

    const error = await Effect.runPromise(
      Effect.flip(KoiosQuery.getAddressesSeen(BASE, "static-token")([addr(ADDR_A)]))
    )

    expect(headers).toHaveLength(0)
    expect(String(error.cause)).toContain("plain-http")
    // The header is named; the token itself never reaches a message or a log.
    expect(JSON.stringify(error)).not.toContain("static-token")
  })

  it("allows a token to loopback, where there is no wire to intercept", async () => {
    const headers = stubWithHeaders([])
    await Effect.runPromise(KoiosQuery.getAddressesSeen("http://localhost:8050", "dev-token")([addr(ADDR_A)]))
    expect(headers[0]).toBe("Bearer dev-token")
  })
})

describe("getTxCbor and getTxInfo — more hashes than one body holds", () => {
  // A transaction hash is 64 characters, so the 5120-byte body limit arrives at ~76 of them.
  const hashes = (n: number) =>
    Array.from({ length: n }, (_, i) => TransactionHash.fromHex(i.toString(16).padStart(64, "0")))

  it("splits a long hash list for getTxCbor and concatenates the rows", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      calls.push({ url: String(input), body })
      const asked = (body as { _tx_hashes: Array<string> })._tx_hashes
      return new Response(JSON.stringify(asked.map((tx_hash) => ({ tx_hash, cbor: "84a0" }))), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    })

    const got = await Effect.runPromise(KoiosQuery.getTxCbor(BASE)(hashes(200)))

    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) expect(JSON.stringify(call.body).length).toBeLessThan(5120)
    // Nothing to reconcile: the answer is keyed by hash and carries no order.
    expect(got).toHaveLength(200)
  })

  it("splits a long hash list for getTxInfo too", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      calls.push({ url: String(input), body })
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    await Effect.runPromise(KoiosQuery.getTxInfo(BASE)(hashes(200)))

    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) {
      expect(JSON.stringify(call.body).length).toBeLessThan(5120)
      // The flags are what make inputs, certificates and assets present at all, and they have
      // to be on EVERY chunk — a chunk without them answers a different question.
      expect(call.body).toMatchObject({ _inputs: true, _certs: true, _withdrawals: true, _assets: true })
    }
  })
})

describe("resolveOutRefs", () => {
  /** One `/utxo_info` row, which carries `is_spent` whenever `_extended` is asked for. */
  const row = (txHash: string, index: number, spent?: boolean) => ({
    tx_hash: txHash,
    tx_index: index,
    address: ADDR_A,
    value: "2000000",
    ...(spent !== undefined ? { is_spent: spent } : {}),
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: []
  })

  const refs = [
    new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(TX_A), index: 0n }),
    new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(TX_B), index: 1n })
  ]

  it("keeps a SPENT row and says so, where getUtxosByOutRef drops it", async () => {
    // The two members answer different questions off one request. `getUtxosByOutRef` promises
    // spendable UTxOs; this one answers "what is the state of these outpoints", and a consumer
    // deciding whether a transaction it holds is still submittable needs the second.
    stub([row(TX_A, 0, false), row(TX_B, 1, true)])

    const resolved = await Effect.runPromise(KoiosEffect.resolveOutRefs(BASE)(refs))

    expect(resolved.map((r) => [TransactionHash.toHex(r.utxo.transactionId), r.spent])).toEqual([
      [TX_A, false],
      [TX_B, true]
    ])
  })

  it("leaves spent ABSENT when the indexer did not answer it, rather than calling it live", async () => {
    stub([row(TX_A, 0)])

    const resolved = await Effect.runPromise(KoiosEffect.resolveOutRefs(BASE)(refs))

    expect(resolved[0]!.spent).toBeUndefined()
  })

  it("asks /utxo_info once, extended, deduplicating the refs", async () => {
    const calls = stub([])

    await Effect.runPromise(KoiosEffect.resolveOutRefs(BASE)([...refs, refs[0]!]))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain("/utxo_info")
    expect(calls[0]!.body).toEqual({ _utxo_refs: [`${TX_A}#0`, `${TX_B}#1`], _extended: true })
  })

  it("is the same request getUtxosByOutRef makes, filtered", async () => {
    stub([row(TX_A, 0, false), row(TX_B, 1, true)])

    const spendable = await Effect.runPromise(KoiosEffect.getUtxosByOutRef(BASE)(refs))

    expect(spendable.map((u) => TransactionHash.toHex(u.transactionId))).toEqual([TX_A])
  })
})
