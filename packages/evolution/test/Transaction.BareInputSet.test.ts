import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as Transaction from "../src/Transaction.js"

/**
 * Adding a witness must not re-encode the body — whichever form the body arrived in.
 *
 * Conway writes a transaction's input set as `#6.258([...])`; Babbage wrote a bare array, and the
 * ledger still accepts it. `TransactionBody`'s decoder takes both, but its encoder always emits
 * the tagged form, so a body that arrived bare came back tagged: **three bytes longer, a different
 * transaction id, and the signature already attached to it.** A wallet co-signing someone else's
 * transaction cannot choose the form it is handed.
 */

// A real transaction whose input set is `#6.258`-tagged: `84 ab 00 d90102 81 8258…`.
const TAGGED_TX_HEX =
  "84ab00d90102818258208078d91b024d72d18a00125c0da1c5bc9405060a2cefbeadbade8133607f57eb010182a3005839104a965ad53909a5fe9f4c931c91c286f767c306647ea35ba326d3ef9e2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c01821a001bd19aa1581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fcaa24341736b0158206c6f616e836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb0701028201d8185874d8799fd8799f581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fca581c34c89038e26522b4e4c627d71620cec18edae05a7ae94ee90e0e76b6581d002decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c9f4040ff187b1aa4cb80009f9f4040ffffffff82583900e8a20635288ddfe3c916daa6fc7ce150136d83b30cc87c860a020b342decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c821a6c02024ba8581c1855a70da3f8b041ff49a6ca063817598b1f7c72d4ef25a292e776f2a1560014df104578707265737320506f6c6c696e61746f7201581c34c89038e26522b4e4c627d71620cec18edae05a7ae94ee90e0e76b6a158206b6696daa9fa0fe7fb3136611113f5f64943a7b6b5a2a50d707ace02ddb561e301581c5ea37393bca4c996086a5d603a748c655f6f8a8c4be742fd1e0f1f64a1447457495a1a0bebc200581c985bb5ad24f633730635cc6501ed5ae8c8e490b6435c67ae58c36665a7480014df105553444d1b000002ba6d437267480014df10574d54581b000002ba7f2f9f40480014df10744941471b000002bcd1708a82490014df1074534e454b1a04c4ca064a0014df1074484f534b591a049d5d514b0014df107453554e4441451b000002bb9890fd084e0014df1057697a617264546573741a00989680581ca9fc2c980e6beed499b91089ca06ad433961a6238690219b8021fe43a3480014df1048554e541b000000037e11d600480014df10494e44591a0436b2494a0014df1053554e4441451b00000005d1ff3576581cafc338a86087b2389ff6e4e14d3305c6994c9908e6b50c6081916390a1447457495a1a05054ec1581cc08487509756b73dd0bd8406454bf0c83da952ca44454941a116d239a14574534e454b1a0a4d3b56581cd0d763bd8d1d6456989405ede72ca5c967351bbad2f2319daf54f9dca144744941471a089f2103021a00062f0d031a072752e309a1581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fcaa24341736b0158206c6f616e836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07010b5820d6e618039f9269fc9b58c4fefc09f277dbddfab32c76f340fa06786c48e6be9b0dd90102818258208d3894c757da4206026eaf45ee1c7d5bd8b38d7dd88f170d9aaf785fc7c52bc5000ed9010281581c2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c1082583900e8a20635288ddfe3c916daa6fc7ce150136d83b30cc87c860a020b342decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c1a00346119111a0017ea2712d9010281825820b83d379cb8ef97f5514c5a9b6a18833c01d244ea9cff7e6a9a84c7a546f3fe6700a105a182010082d8799fd8799f581c2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8cffff821a000319db1a03b9dee0f5f6"

/** The same transaction with its input set as a BARE array: the `d90102` after key `00` removed. */
const BARE_TX_HEX = TAGGED_TX_HEX.replace("84ab00d90102", "84ab00")

const WALLET_WITNESS_SET_HEX = `a10081825820${"aa".repeat(32)}5840${"bb".repeat(64)}`

const bodyHex = (txHex: string) => Bytes.toHex(Transaction.extractBodyBytes(Bytes.fromHex(txHex)))

describe("addVKeyWitnesses over a bare input set", () => {
  it("leaves the body byte-identical when the input set arrived TAGGED", () => {
    const signed = Transaction.addVKeyWitnessesHex(TAGGED_TX_HEX, WALLET_WITNESS_SET_HEX)
    expect(bodyHex(signed)).toBe(bodyHex(TAGGED_TX_HEX))
  })

  it("leaves the body byte-identical when the input set arrived BARE", () => {
    // Without this, the body came back three bytes longer with the tag reinstated — a different
    // transaction than the one that was reviewed and signed.
    const signed = Transaction.addVKeyWitnessesHex(BARE_TX_HEX, WALLET_WITNESS_SET_HEX)
    expect(bodyHex(signed)).toBe(bodyHex(BARE_TX_HEX))
  })

  it("the two forms are genuinely different bytes, so the pair above is a real test", () => {
    expect(bodyHex(BARE_TX_HEX)).not.toBe(bodyHex(TAGGED_TX_HEX))
    expect(bodyHex(TAGGED_TX_HEX).length - bodyHex(BARE_TX_HEX).length).toBe(6)
  })

  it("still adds the witness it was asked to add", () => {
    const signed = Transaction.addVKeyWitnessesHex(BARE_TX_HEX, WALLET_WITNESS_SET_HEX)
    expect(signed).toContain("aa".repeat(32))
    expect(signed).toContain("bb".repeat(64))
  })

  it("round-trips a bare input set through decode and encode unchanged", () => {
    const tx = Transaction.fromCBORHex(BARE_TX_HEX)
    expect(tx.body.inputs).toHaveLength(1)
    const { format, value } = Transaction.fromCBORBytesWithFormat(Bytes.fromHex(BARE_TX_HEX))
    expect(Bytes.toHex(Transaction.toCBORBytesWithFormat(value, format))).toBe(BARE_TX_HEX)
  })
})
