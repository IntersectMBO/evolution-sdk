import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as DatumHash from "../src/DatumHash.js"
import * as RewardAddress from "../src/RewardAddress.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import { MockProvider } from "../src/sdk/provider/Mock.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionInput from "../src/TransactionInput.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const WALLET = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const RECEIVER =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

const STAKE = RewardAddress.RewardAddress.make("stake_test1uqevw2xnsc0pvn9t9r9c7qdfzyf8vyhmqxkjxnwv2d7aps8x8qqxq")

const NFT = `${"ab".repeat(28)}${Buffer.from("MockNFT").toString("hex")}`

const walletUtxo = createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0, address: WALLET, lovelace: 10_000_000n })

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("MockProvider – reads", () => {
  it("serves UTxOs by address, and nothing for an address it does not hold", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo] })

    const mine = await run(provider.effect.getUtxos(CoreAddress.fromBech32(WALLET)))
    const theirs = await run(provider.effect.getUtxos(CoreAddress.fromBech32(RECEIVER)))

    expect(mine).toHaveLength(1)
    expect(mine[0].assets.lovelace).toBe(10_000_000n)
    expect(theirs).toHaveLength(0)
  })

  it("serves UTxOs by payment credential, and only those", async () => {
    const other = createCoreTestUtxo({ transactionId: "c".repeat(64), address: RECEIVER, lovelace: 5_000_000n })
    const provider = new MockProvider({ utxos: [walletUtxo, other] })
    const credential = CoreAddress.getPaymentCredential(WALLET)
    if (!credential) throw new Error("the fixture address has a payment credential")

    const found = await run(provider.effect.getUtxos(credential))

    expect(found).toHaveLength(1)
    expect(found[0].assets.lovelace).toBe(10_000_000n)
  })

  it("filters by unit, and resolves a unit held at exactly one address", async () => {
    const withNft = createCoreTestUtxo({
      transactionId: "b".repeat(64),
      index: 0,
      address: WALLET,
      lovelace: 2_000_000n,
      nativeAssets: { [NFT]: 1n }
    })
    const provider = new MockProvider({ utxos: [walletUtxo, withNft] })
    const address = CoreAddress.fromBech32(WALLET)

    const filtered = await run(provider.effect.getUtxosWithUnit(address, NFT))
    const byUnit = await run(provider.effect.getUtxoByUnit(NFT))

    expect(filtered).toHaveLength(1)
    expect(byUnit.assets.lovelace).toBe(2_000_000n)
  })

  it("fails on a unit nobody holds, and on one spread over two addresses", async () => {
    const empty = new MockProvider({ utxos: [walletUtxo] })
    await expect(run(empty.effect.getUtxoByUnit(NFT))).rejects.toThrow("Unit not found")

    const split = new MockProvider({
      utxos: [
        createCoreTestUtxo({ transactionId: "b".repeat(64), address: WALLET, lovelace: 2_000_000n, nativeAssets: { [NFT]: 1n } }),
        createCoreTestUtxo({ transactionId: "c".repeat(64), address: RECEIVER, lovelace: 2_000_000n, nativeAssets: { [NFT]: 1n } })
      ]
    })
    await expect(run(split.effect.getUtxoByUnit(NFT))).rejects.toThrow("only held by one address")
  })

  it("resolves outpoints it holds and omits the ones it does not", async () => {
    const other = createCoreTestUtxo({ transactionId: "c".repeat(64), address: RECEIVER, lovelace: 5_000_000n })
    const provider = new MockProvider({ utxos: [walletUtxo, other] })
    const known = new TransactionInput.TransactionInput({ transactionId: walletUtxo.transactionId, index: 0n })
    const unknown = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("f".repeat(64)),
      index: 7n
    })

    const found = await run(provider.effect.getUtxosByOutRef([known, unknown]))

    expect(found).toHaveLength(1)
    expect(found[0].transactionId).toStrictEqual(walletUtxo.transactionId)
  })

  it("reports an unseeded datum or delegation as a failure, not as an empty answer", async () => {
    const provider = new MockProvider()

    await expect(run(provider.effect.getDatum(DatumHash.fromHex("1".repeat(64))))).rejects.toThrow("No Datum Found")
    await expect(run(provider.effect.getDelegation(STAKE))).rejects.toThrow("No Delegation Found")
  })
})

describe("MockProvider – submit moves the ledger", () => {
  const build = async (provider: MockProvider, utxos = provider.ledger()) => {
    const params = await run(provider.effect.getProtocolParameters())
    const signBuilder = await makeTxBuilder({ chain: mainnet })
      .payToAddress({ address: CoreAddress.fromBech32(RECEIVER), assets: CoreAssets.fromLovelace(3_000_000n) })
      .build({
        changeAddress: CoreAddress.fromBech32(WALLET),
        availableUtxos: utxos,
        fullProtocolParameters: params
      })
    return signBuilder.toTransaction()
  }

  it("returns the transaction's own hash, as CML computes it", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo] })
    const tx = await build(provider)

    const hash = await run(provider.effect.submitTx(tx))

    const cmlHash = CML.hash_transaction(CML.Transaction.from_cbor_hex(Transaction.toCBORHex(tx)).body()).to_hex()
    expect(TransactionHash.toHex(hash)).toBe(cmlHash)
  })

  it("spends the inputs and creates the outputs", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo] })
    const tx = await build(provider)

    const hash = await run(provider.effect.submitTx(tx))
    const ledger = provider.ledger()

    expect(ledger.map((u) => TransactionHash.toHex(u.transactionId))).not.toContain(
      TransactionHash.toHex(walletUtxo.transactionId)
    )
    expect(ledger).toHaveLength(tx.body.outputs.length)
    expect(ledger.every((u) => TransactionHash.toHex(u.transactionId) === TransactionHash.toHex(hash))).toBe(true)
    const paid = ledger.find((u) => CoreAddress.toBech32(u.address) === RECEIVER)
    expect(paid?.assets.lovelace).toBe(3_000_000n)
  })

  it("refuses to spend the same input twice", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo] })
    const tx = await build(provider)

    await run(provider.effect.submitTx(tx))

    await expect(run(provider.effect.submitTx(tx))).rejects.toThrow("already spent")
  })

  it("chains: the second transaction spends the first one's change", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo] })
    const first = await build(provider)
    await run(provider.effect.submitTx(first))

    const change = provider.ledger().filter((u) => CoreAddress.toBech32(u.address) === WALLET)
    expect(change).toHaveLength(1)

    const second = await build(provider, change)
    const hash = await run(provider.effect.submitTx(second))

    expect(await run(provider.effect.awaitTx(hash))).toBe(true)
  })

  it("confirms what it was given and what it accepted, and nothing else", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo], confirmedTxs: ["d".repeat(64)] })

    expect(await run(provider.effect.awaitTx(TransactionHash.fromHex("d".repeat(64))))).toBe(true)
    expect(await run(provider.effect.awaitTx(TransactionHash.fromHex("e".repeat(64))))).toBe(false)
  })
})

describe("MockProvider – evaluation", () => {
  it("evaluates a script-free transaction as having nothing to evaluate", async () => {
    const provider = new MockProvider({ utxos: [walletUtxo] })
    const params = await run(provider.effect.getProtocolParameters())
    const signBuilder = await makeTxBuilder({ chain: mainnet })
      .payToAddress({ address: CoreAddress.fromBech32(RECEIVER), assets: CoreAssets.fromLovelace(3_000_000n) })
      .build({
        changeAddress: CoreAddress.fromBech32(WALLET),
        availableUtxos: [walletUtxo],
        fullProtocolParameters: params
      })
    const tx = await signBuilder.toTransaction()

    expect(await run(provider.effect.evaluateTx(tx))).toStrictEqual([])
  })

  it("serves the ex-units it was seeded with", async () => {
    const seeded = [{ ex_units: { mem: 1n, steps: 2n }, redeemer_index: 0, redeemer_tag: "spend" }] as never
    const provider = new MockProvider({ evalRedeemers: seeded })
    const params = await run(provider.effect.getProtocolParameters())
    const signBuilder = await makeTxBuilder({ chain: mainnet })
      .payToAddress({ address: CoreAddress.fromBech32(RECEIVER), assets: CoreAssets.fromLovelace(3_000_000n) })
      .build({
        changeAddress: CoreAddress.fromBech32(WALLET),
        availableUtxos: [walletUtxo],
        fullProtocolParameters: params
      })
    const tx = await signBuilder.toTransaction()

    expect(await run(provider.effect.evaluateTx(tx))).toStrictEqual(seeded)
  })
})

/**
 * The history and discovery tier.
 *
 * ⚠️ Each member EXISTS only where the config seeded it. That is the property a consumer's
 * "history unavailable" branch is tested against — a mock that always answered would make every
 * capability probe look satisfied, and the consumer's absence handling would never run.
 */
describe("MockProvider – the history and discovery tier", () => {
  const TX_A = "aa".repeat(32)
  const TX_B = "bb".repeat(32)
  const refs = [
    { txHash: TransactionHash.fromHex(TX_A), blockHeight: 500 },
    { txHash: TransactionHash.fromHex(TX_B), blockHeight: 400 }
  ]

  it("has no history at all unless a test seeds it", () => {
    const bare = new MockProvider({})
    expect(bare.effect.getTxsAt).toBeUndefined()
    expect(bare.effect.getAccountTxs).toBeUndefined()
    expect(bare.effect.getTxInfo).toBeUndefined()
    expect(bare.effect.getTxCbor).toBeUndefined()
    expect(bare.effect.getAccountAddresses).toBeUndefined()
    expect(bare.effect.getAddressesSeen).toBeUndefined()
    expect(bare.effect.getTxConfirmations).toBeUndefined()
    expect(bare.effect.getScriptByHash).toBeUndefined()
    expect(bare.effect.resolveOutRefs).toBeUndefined()
  })

  it("answers references newest-first, and windows them the way a walk steps", async () => {
    const provider = new MockProvider({ txRefs: refs })

    const all = await run(provider.effect.getTxsAt!([CoreAddress.fromBech32(WALLET)]))
    expect(all.map((r) => r.blockHeight)).toEqual([500, 400])

    // `afterBlock` is exclusive below, `beforeBlock` exclusive above.
    const above = await run(provider.effect.getAccountTxs!(STAKE, { afterBlock: 400 }))
    expect(above.map((r) => r.blockHeight)).toEqual([500])
    const below = await run(provider.effect.getAccountTxs!(STAKE, { beforeBlock: 500 }))
    expect(below.map((r) => r.blockHeight)).toEqual([400])
  })

  it("orders BEFORE it pages, so an ascending page is the oldest rows", async () => {
    // ⚠️ Paging first and ordering after would answer the newest row for `order: "asc"` with a
    // limit of 1 — the wrong rows, not merely the wrong order.
    const provider = new MockProvider({ txRefs: refs })

    const oldest = await run(provider.effect.getAccountTxs!(STAKE, { order: "asc", limit: 1 }))
    expect(oldest.map((r) => r.blockHeight)).toEqual([400])
  })

  it("resolves an outpoint it holds as UNSPENT, one it consumed as SPENT, and an unknown one not at all", async () => {
    // ⚠️ The distinction a lookup table cannot make, and the reason this mock is a ledger:
    // "the output is gone" and "the backend never saw it" are different answers, and a caller
    // deciding whether a transaction it holds can still be submitted needs them apart.
    const provider = new MockProvider({ utxos: [walletUtxo], resolvesOutRefs: true })
    const held = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("a".repeat(64)),
      index: 0n
    })
    const unknown = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex("ff".repeat(32)),
      index: 0n
    })

    const before = await run(provider.effect.resolveOutRefs!([held, unknown]))
    expect(before.map((r) => r.spent)).toEqual([false])

    // Spend it through the ledger, the way a submitted transaction does.
    const params = await run(provider.effect.getProtocolParameters())
    const signBuilder = await makeTxBuilder({ chain: mainnet })
      .payToAddress({ address: CoreAddress.fromBech32(RECEIVER), assets: CoreAssets.fromLovelace(3_000_000n) })
      .build({
        changeAddress: CoreAddress.fromBech32(WALLET),
        availableUtxos: provider.ledger(),
        fullProtocolParameters: params
      })
    await run(provider.effect.submitTx(await signBuilder.toTransaction()))

    const after = await run(provider.effect.resolveOutRefs!([held, unknown]))
    // The consumed outpoint is still resolvable and now flagged; the unknown one is still absent.
    expect(after.map((r) => r.spent)).toEqual([true])
  })
})

describe("MockProvider – the credential queries", () => {
  it("answers by payment credential, so a base and an enterprise address read as one spender", async () => {
    // ⚠️ `getUtxos` already answers a credential; serving that and not these would make a
    // consumer look unsupported over a ledger that holds the answer.
    const provider = new MockProvider({ utxos: [walletUtxo] })
    const credential = CoreAddress.fromBech32(WALLET).paymentCredential!

    const one = await run(provider.effect.getUtxosByPaymentCredential!(credential))
    const many = await run(provider.effect.getUtxosByPaymentCredentials!([credential]))

    expect(one).toHaveLength(1)
    expect(many).toHaveLength(1)
    expect(await run(provider.effect.getUtxosByPaymentCredential!(
      CoreAddress.fromBech32(RECEIVER).paymentCredential!
    ))).toHaveLength(0)
  })
})
