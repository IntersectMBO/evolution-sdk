import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as Transaction from "../src/Transaction.js"

/**
 * A transaction body key this schema does not model must be REFUSED, not dropped.
 *
 * The body decoder reads its fields by key and builds the domain value from them, so a key it does
 * not read is simply absent from the result — and the re-encode omits it. Measured on the mainnet
 * transaction below, which is 1268 bytes: given one extra key it goes in at 1271 and comes back out
 * as the original 1268, byte for byte, with nothing raised. A different transaction, a different id.
 *
 * ⚠️ **Dropping is the dangerous half, and preserving would be no better.** This schema models
 * every valid Conway body key (0–5, 7–9, 11, 13–22), so an unmodelled key means one of two things:
 * a pre-Conway field this schema cannot represent, or a field from an era newer than this build.
 * In both cases a wallet that carried the bytes through would be signing a field it could not
 * display, which is the one thing a review step exists to prevent. So it refuses.
 */

const TX_WITH_KEY_199 = (() => {
  // `84 ab …` — a 4-element transaction whose body is an 11-pair map. Widen the map to 12 pairs
  // and append key 199 (`18c7`) with the value 0, which is CBOR this schema has no field for.
  const tagged =
    "84ab00d90102818258208078d91b024d72d18a00125c0da1c5bc9405060a2cefbeadbade8133607f57eb010182a3005839104a965ad53909a5fe9f4c931c91c286f767c306647ea35ba326d3ef9e2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c01821a001bd19aa1581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fcaa24341736b0158206c6f616e836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb0701028201d8185874d8799fd8799f581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fca581c34c89038e26522b4e4c627d71620cec18edae05a7ae94ee90e0e76b6581d002decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c9f4040ff187b1aa4cb80009f9f4040ffffffff82583900e8a20635288ddfe3c916daa6fc7ce150136d83b30cc87c860a020b342decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c821a6c02024ba8581c1855a70da3f8b041ff49a6ca063817598b1f7c72d4ef25a292e776f2a1560014df104578707265737320506f6c6c696e61746f7201581c34c89038e26522b4e4c627d71620cec18edae05a7ae94ee90e0e76b6a158206b6696daa9fa0fe7fb3136611113f5f64943a7b6b5a2a50d707ace02ddb561e301581c5ea37393bca4c996086a5d603a748c655f6f8a8c4be742fd1e0f1f64a1447457495a1a0bebc200581c985bb5ad24f633730635cc6501ed5ae8c8e490b6435c67ae58c36665a7480014df105553444d1b000002ba6d437267480014df10574d54581b000002ba7f2f9f40480014df10744941471b000002bcd1708a82490014df1074534e454b1a04c4ca064a0014df1074484f534b591a049d5d514b0014df107453554e4441451b000002bb9890fd084e0014df1057697a617264546573741a00989680581ca9fc2c980e6beed499b91089ca06ad433961a6238690219b8021fe43a3480014df1048554e541b000000037e11d600480014df10494e44591a0436b2494a0014df1053554e4441451b00000005d1ff3576581cafc338a86087b2389ff6e4e14d3305c6994c9908e6b50c6081916390a1447457495a1a05054ec1581cc08487509756b73dd0bd8406454bf0c83da952ca44454941a116d239a14574534e454b1a0a4d3b56581cd0d763bd8d1d6456989405ede72ca5c967351bbad2f2319daf54f9dca144744941471a089f2103021a00062f0d031a072752e309a1581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fcaa24341736b0158206c6f616e836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07010b5820d6e618039f9269fc9b58c4fefc09f277dbddfab32c76f340fa06786c48e6be9b0dd90102818258208d3894c757da4206026eaf45ee1c7d5bd8b38d7dd88f170d9aaf785fc7c52bc5000ed9010281581c2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c1082583900e8a20635288ddfe3c916daa6fc7ce150136d83b30cc87c860a020b342decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c1a00346119111a0017ea2712d9010281825820b83d379cb8ef97f5514c5a9b6a18833c01d244ea9cff7e6a9a84c7a546f3fe6700a105a182010082d8799fd8799f581c2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8cffff821a000319db1a03b9dee0f5f6"
  const bodyEnd = Transaction.extractBodyBytes(Bytes.fromHex(tagged)).length
  const head = tagged.slice(0, 4) // "84ab"
  const body = tagged.slice(4, 2 + bodyEnd * 2)
  const rest = tagged.slice(2 + bodyEnd * 2)
  return `${head.replace(/ab$/, "ac")}${body}18c700${rest}`
})()

describe("a transaction body key this schema does not model", () => {
  it("is the fixture the measurement above describes", () => {
    // Pins the two numbers in the doc comment to the bytes they were measured from.
    expect(Bytes.fromHex(TX_WITH_KEY_199)).toHaveLength(1271)
    expect(Bytes.fromHex(TX_WITH_KEY_199.replace("18c700", "").replace(/^84ac/, "84ab"))).toHaveLength(1268)
  })

  it("is refused at decode, rather than dropped from the re-encode", () => {
    expect(() => Transaction.fromCBORHex(TX_WITH_KEY_199)).toThrow(/199/)
  })

  it("names the key, so the failure says which field was not understood", () => {
    expect(() => Transaction.fromCBORHex(TX_WITH_KEY_199)).toThrow(/transaction body/i)
  })

  it("still accepts a body made only of keys it models", () => {
    const valid = TX_WITH_KEY_199.replace("18c700", "").replace(/^84ac/, "84ab")
    const tx = Transaction.fromCBORHex(valid)
    expect(tx.body.inputs).toHaveLength(1)
  })
})
