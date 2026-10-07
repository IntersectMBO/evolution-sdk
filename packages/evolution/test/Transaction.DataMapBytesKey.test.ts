import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as Transaction from "../src/Transaction.js"

// A Plutus data map with byte-string keys inside a witness datum or redeemer
// must keep its original bytes after decode and re-encode, because the script
// data hash covers those bytes. Integer keys always kept them; byte keys lost
// the format of the value under each key.

// Real transaction; only its body is used, with hand-built witness sets
const FIXTURE_TX_HEX =
  "84ab00d90102818258208078d91b024d72d18a00125c0da1c5bc9405060a2cefbeadbade8133607f57eb010182a3005839104a965ad53909a5fe9f4c931c91c286f767c306647ea35ba326d3ef9e2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c01821a001bd19aa1581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fcaa24341736b0158206c6f616e836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb0701028201d8185874d8799fd8799f581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fca581c34c89038e26522b4e4c627d71620cec18edae05a7ae94ee90e0e76b6581d002decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c9f4040ff187b1aa4cb80009f9f4040ffffffff82583900e8a20635288ddfe3c916daa6fc7ce150136d83b30cc87c860a020b342decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c821a6c02024ba8581c1855a70da3f8b041ff49a6ca063817598b1f7c72d4ef25a292e776f2a1560014df104578707265737320506f6c6c696e61746f7201581c34c89038e26522b4e4c627d71620cec18edae05a7ae94ee90e0e76b6a158206b6696daa9fa0fe7fb3136611113f5f64943a7b6b5a2a50d707ace02ddb561e301581c5ea37393bca4c996086a5d603a748c655f6f8a8c4be742fd1e0f1f64a1447457495a1a0bebc200581c985bb5ad24f633730635cc6501ed5ae8c8e490b6435c67ae58c36665a7480014df105553444d1b000002ba6d437267480014df10574d54581b000002ba7f2f9f40480014df10744941471b000002bcd1708a82490014df1074534e454b1a04c4ca064a0014df1074484f534b591a049d5d514b0014df107453554e4441451b000002bb9890fd084e0014df1057697a617264546573741a00989680581ca9fc2c980e6beed499b91089ca06ad433961a6238690219b8021fe43a3480014df1048554e541b000000037e11d600480014df10494e44591a0436b2494a0014df1053554e4441451b00000005d1ff3576581cafc338a86087b2389ff6e4e14d3305c6994c9908e6b50c6081916390a1447457495a1a05054ec1581cc08487509756b73dd0bd8406454bf0c83da952ca44454941a116d239a14574534e454b1a0a4d3b56581cd0d763bd8d1d6456989405ede72ca5c967351bbad2f2319daf54f9dca144744941471a089f2103021a00062f0d031a072752e309a1581c87cb436d92d733c239120af93f1988bd49709eecdbe6b93216992fcaa24341736b0158206c6f616e836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07010b5820d6e618039f9269fc9b58c4fefc09f277dbddfab32c76f340fa06786c48e6be9b0dd90102818258208d3894c757da4206026eaf45ee1c7d5bd8b38d7dd88f170d9aaf785fc7c52bc5000ed9010281581c2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c1082583900e8a20635288ddfe3c916daa6fc7ce150136d83b30cc87c860a020b342decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8c1a00346119111a0017ea2712d9010281825820b83d379cb8ef97f5514c5a9b6a18833c01d244ea9cff7e6a9a84c7a546f3fe6700a105a182010082d8799fd8799f581c2decd801bc24246797eb8c35bbdf98ed854d4a08a806853006817e8cffff821a000319db1a03b9dee0f5f6"

const BODY_HEX = FIXTURE_TX_HEX.slice(2, CBOR.decodeItemWithOffset(Bytes.fromHex(FIXTURE_TX_HEX), 1).newOffset * 2)

const EX_UNITS_HEX = "821a000319db1a03b9dee0"

const WALLET_WITNESS_SET_HEX = "a10081825820" + "aa".repeat(32) + "5840" + "bb".repeat(64)

// 70-byte key, written as a chunked byte string (64 + 6) as Plutus data requires
const LONG_KEY_HEX = "5f5840" + "ab".repeat(64) + "46" + "cd".repeat(6) + "ff"

const DATA_CASES: ReadonlyArray<readonly [string, string]> = [
  ["definite map, byte key, indefinite list value", "d8799fa141019f0102ffff"],
  ["indefinite map, byte key, indefinite list value", "d8799fbf41019f0102ffffff"],
  ["chunked byte key longer than 64 bytes", "d8799fa1" + LONG_KEY_HEX + "9f0102ffff"],
  ["two byte keys in unsorted order", "d8799fa241029f01ff41019f02ffff"],
  ["list key holding a byte string", "d8799fa18141019f0102ffff"],
  ["constr key holding a byte string", "d8799fa1d8798141019f0102ffff"],
  ["repeated byte key with different values", "d8799fa241019f01ff41019f02ffff"],
  ["integer key (control)", "d8799fa1019f0102ffff"],
  ["all definite (control)", "d87981a14101820102"]
]

const datumWitnessSet = (data: string) => "a104d9010281" + data
const redeemerArrayWitnessSet = (data: string) => "a10581840000" + data + EX_UNITS_HEX
const redeemerMapWitnessSet = (data: string) => "a105a1820000" + "82" + data + EX_UNITS_HEX

const WITNESS_FORMS = [
  ["witness datum", datumWitnessSet],
  ["redeemer array form", redeemerArrayWitnessSet],
  ["redeemer map form", redeemerMapWitnessSet]
] as const

const txHex = (witnessSetHex: string) => "84" + BODY_HEX + witnessSetHex + "f5f6"

describe("Transaction keeps Plutus data maps with byte-string keys", () => {
  for (const [form, witnessSet] of WITNESS_FORMS) {
    describe(form, () => {
      for (const [name, data] of DATA_CASES) {
        it(`fromCBORHex then toCBORHex round-trips: ${name}`, () => {
          const hex = txHex(witnessSet(data))
          expect(Transaction.toCBORHex(Transaction.fromCBORHex(hex))).toBe(hex)
        })

        it(`addVKeyWitnessesHex keeps the original witness bytes: ${name}`, () => {
          const witnessSetHex = witnessSet(data)
          const signed = Transaction.addVKeyWitnessesHex(txHex(witnessSetHex), WALLET_WITNESS_SET_HEX)

          expect(signed.startsWith("84" + BODY_HEX)).toBe(true)
          // The original entry is replayed first, with the vkey witnesses appended after it
          expect(signed.slice(2 + BODY_HEX.length, 4 + BODY_HEX.length)).toBe("a2")
          expect(signed.slice(4 + BODY_HEX.length)).toContain(witnessSetHex.slice(2))
          expect(Transaction.fromCBORHex(signed).witnessSet.vkeyWitnesses?.length).toBe(1)
        })
      }
    })
  }
})

describe("CBOR.toCBORHexWithFormat on a Data map with byte-string keys", () => {
  for (const [name, hex] of DATA_CASES) {
    it(`reproduces the original bytes: ${name}`, () => {
      const { format } = CBOR.fromCBORHexWithFormat(hex)
      const data = Data.fromCBORHex(hex)
      const cbor = Schema.encodeSync(Data.FromCDDL)(data)
      expect(CBOR.toCBORHexWithFormat(cbor, format)).toBe(hex)
    })
  }
})
