import { describe, expect, it } from "vitest"

import * as AuxiliaryData from "../src/AuxiliaryData.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as CostModel from "../src/CostModel.js"
import * as Data from "../src/Data.js"
import * as Metadata from "../src/Metadata.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as Redeemers from "../src/Redeemers.js"
import * as ScriptDataHash from "../src/ScriptDataHash.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionMetadatum from "../src/TransactionMetadatum.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as TxOut from "../src/TxOut.js"

/**
 * Assembling a transaction from parts a builder already holds as bytes.
 *
 * A builder accumulates body and witness-set fields from plugins -- a certificate from one, a
 * withdrawal map from another, a `script_data_hash` over bytes it does not model -- and has no
 * typed value for most of them. These constructors are that boundary.
 */
const B = (hex: string) => Bytes.fromHex(hex)
const hx = (bytes: Uint8Array) => Bytes.toHex(bytes)

const TX_ID = "aa".repeat(32)

const inputHex = "8258" + "20" + TX_ID + "00"
const outputHex = TxOut.toCBORHex(TxOut.fromCBORHex(`82581d60${"11".repeat(28)}1a001e8480`))

/** `Constr 1 []` indefinite-framed: the one Plutus shape no set of encoder options can express. */
const D10 = "d87a9fff"

describe("a transaction body from encoded parts", () => {
  it("writes the inputs as the #6.258 set Conway expects", () => {
    const body = TransactionBody.fromEncoded({ inputs: [B(inputHex)], outputs: [B(outputHex)], fee: 200_000n })
    expect(TransactionBody.toCBORHex(body)).toContain("00d9010281")
  })

  it("round-trips through its own decoder", () => {
    const body = TransactionBody.fromEncoded({
      inputs: [B(inputHex)],
      outputs: [B(outputHex)],
      fee: 200_000n,
      ttl: 1000n
    })
    const hex = TransactionBody.toCBORHex(body)
    expect(TransactionBody.toCBORHex(TransactionBody.fromCBORHex(hex))).toBe(hex)
    const back = TransactionBody.fromCBORHex(hex)
    expect(back.fee).toBe(200_000n)
    expect(back.ttl).toBe(1000n)
    expect(back.inputs).toHaveLength(1)
  })

  it("omits ttl when it was not given, rather than defaulting it", () => {
    // ⚠️ A TTL of 0 is a transaction that can never be submitted, so an absent TTL must stay
    // absent — this is the field where a convenient default is a dead transaction.
    const body = TransactionBody.fromEncoded({ inputs: [B(inputHex)], outputs: [B(outputHex)], fee: 1n })
    expect(body.ttl).toBeUndefined()
    expect(TransactionBody.toCBORHex(body)).not.toContain("03")
  })

  it("places each modelled field under its CDDL key", () => {
    const body = TransactionBody.fromEncoded({
      inputs: [B(inputHex)],
      outputs: [B(outputHex)],
      fee: 1n,
      fields: [
        [14, CBOR.encodeTaggedSet([CBOR.toCBORBytes(B("aa".repeat(28)))])],
        [15, CBOR.toCBORBytes(0n)]
      ]
    })
    expect(body.requiredSigners).toHaveLength(1)
    expect(body.networkId).toBe(0)
  })

  it("refuses a key it does not model by naming it, rather than dropping the field", () => {
    // Dropping it would be a body the caller did not ask for, signed anyway.
    expect(() =>
      TransactionBody.fromEncoded({
        inputs: [B(inputHex)],
        outputs: [B(outputHex)],
        fee: 1n,
        fields: [[99, CBOR.toCBORBytes(0n)]]
      })
    ).toThrow(/key 99 is not modelled/)
  })
})

describe("a witness set from encoded parts", () => {
  const vkey = "11".repeat(32)
  const signature = "22".repeat(64)

  it("carries vkey witnesses", () => {
    const ws = TransactionWitnessSet.fromEncoded({ vkeyWitnesses: [{ vkey: B(vkey), signature: B(signature) }] })
    expect(TransactionWitnessSet.toCBORHex(ws)).toBe(`a100d9010281825820${vkey}5840${signature}`)
  })

  it("splits a script field's set into its items", () => {
    const script = "4e4d01000033222220051200120011"
    const ws = TransactionWitnessSet.fromEncoded({
      fields: [[7, CBOR.encodeTaggedSet([CBOR.toCBORBytes(B(script))])]]
    })
    expect(ws.plutusV3Scripts).toHaveLength(1)
    expect(TransactionWitnessSet.toCBORHex(ws)).toContain(script)
  })

  it("models plutus_data (4) and redeemers (5), which are not script-shaped", () => {
    // ⚠️ A table that handled only the script shape made assembling the witness set of ANY Plutus
    // transaction throw, including the sizing pass every fee estimate runs.
    const ws = TransactionWitnessSet.fromEncoded({
      fields: [
        [4, CBOR.encodeTaggedSet([B("d87980")])],
        [5, Redeemers.spliceMap([{ tag: 0, index: 0n, data: B("182a"), mem: 1n, steps: 2n }])]
      ]
    })
    expect(ws.plutusData).toHaveLength(1)
    expect(ws.redeemers).toBeDefined()
  })

  it("refuses a key it does not model", () => {
    expect(() => TransactionWitnessSet.fromEncoded({ fields: [[9, CBOR.toCBORBytes(0n)]] })).toThrow(
      /key 9 is not modelled/
    )
  })
})

/**
 * ⚠️ The defect this whole group exists for, and it was live.
 *
 * A builder splices a redeemer's data bytes to compute `script_data_hash`, then hands the same
 * bytes to the witness set. The witness set decoded them into a typed `Redeemer` and re-encoded
 * them, which reframed an empty indefinite array -- so the hash in the body and the redeemers in
 * the witness set described DIFFERENT bytes. Nothing fails locally; the node recomputes the hash
 * from the witness set, disagrees, and the transaction fails phase 2.
 *
 * No golden vector caught it because the corpus had a D10 redeemer through `script_data_hash` and
 * a D10 redeemer through the redeemer map, but never one through an assembled witness set.
 */
describe("Plutus bytes survive the witness set they are put into", () => {
  it("keeps a redeemer's data when the witness set is assembled from it", () => {
    const map = Redeemers.spliceMap([{ tag: 0, index: 0n, data: B(D10), mem: 1n, steps: 2n }])
    const ws = TransactionWitnessSet.fromEncoded({ fields: [[5, map]] })
    expect(TransactionWitnessSet.toCBORHex(ws)).toContain(hx(map))
  })

  for (const [name, hex] of [
    ["redeemers (key 5)", `a105a182000082${D10}820102`],
    ["plutus_data (key 4)", `a104d9010281${D10}`],
    ["both at once", `a204d9010281${D10}05a182000082${D10}820102`]
  ] as const) {
    it(`keeps ${name} across a witness-set decode and re-encode`, () => {
      expect(TransactionWitnessSet.toCBORHex(TransactionWitnessSet.fromCBORHex(hex))).toBe(hex)
    })
  }

  for (const [form, hex] of [
    ["map", `a182000082${D10}820102`],
    ["array", `81840000${D10}820102`]
  ] as const) {
    it(`keeps a ${form}-form redeemer's data across a decode and re-encode`, () => {
      const decode = form === "map" ? Redeemers.fromCBORHexMap : Redeemers.fromCBORHex
      const encode = form === "map" ? Redeemers.toCBORHexMap : Redeemers.toCBORHex
      expect(encode(decode(hex) as never)).toBe(hex)
    })
  }

  it("so the script data hash of the re-encoded redeemers matches the original", () => {
    const map = Redeemers.spliceMap([{ tag: 0, index: 0n, data: B(D10), mem: 1n, steps: 2n }])
    const empty = new CostModel.CostModels({
      PlutusV1: new CostModel.CostModel({ costs: [] }),
      PlutusV2: new CostModel.CostModel({ costs: [] }),
      PlutusV3: new CostModel.CostModel({ costs: [] })
    })
    const fromSpliced = Redeemers.toScriptDataHashFromEncoded(map, undefined, empty)
    const reEncoded = B(Redeemers.toCBORHexMap(Redeemers.fromCBORBytesMap(map)))
    expect(ScriptDataHash.toHex(Redeemers.toScriptDataHashFromEncoded(reEncoded, undefined, empty))).toBe(
      ScriptDataHash.toHex(fromSpliced)
    )
  })
})

describe("the redeemer splice map", () => {
  it("sorts its keys bytewise over their encoded form", () => {
    // Given out of order; the ledger requires the canonical order to reconstruct the map.
    const out = hx(
      Redeemers.spliceMap([
        { tag: 1, index: 0n, data: B("9fff"), mem: 1n, steps: 2n },
        { tag: 0, index: 0n, data: B("182a"), mem: 3n, steps: 4n }
      ])
    )
    expect(out).toBe("a282000082182a820304820100829fff820102")
    expect(out.indexOf("820000")).toBeLessThan(out.indexOf("820100"))
  })

  it("splices the data rather than re-encoding it", () => {
    expect(hx(Redeemers.spliceMap([{ tag: 0, index: 0n, data: B(D10), mem: 1n, steps: 2n }]))).toContain(D10)
  })
})

describe("script_data_hash over encoded parts", () => {
  const empty = new CostModel.CostModels({
    PlutusV1: new CostModel.CostModel({ costs: [] }),
    PlutusV2: new CostModel.CostModel({ costs: [] }),
    PlutusV3: new CostModel.CostModel({ costs: [] })
  })
  const datums = CBOR.encodeTaggedSet([B("d87980")])

  it("hashes redeemers ‖ datums ‖ language_views", async () => {
    const { blake2b } = await import("@noble/hashes/blake2.js")
    const map = Redeemers.spliceMap([{ tag: 0, index: 0n, data: B("182a"), mem: 1n, steps: 2n }])
    const views = CostModel.languageViewsEncoding(empty)
    const expected = blake2b(new Uint8Array([...map, ...datums, ...views]), { dkLen: 32 })
    expect(ScriptDataHash.toHex(Redeemers.toScriptDataHashFromEncoded(map, datums, empty))).toBe(hx(expected))
  })

  it("applies the Conway special case when there are datums but no redeemers", async () => {
    const { blake2b } = await import("@noble/hashes/blake2.js")
    // A0 ‖ datums ‖ A0, NOT datums ‖ language_views.
    const expected = blake2b(new Uint8Array([0xa0, ...datums, 0xa0]), { dkLen: 32 })
    expect(ScriptDataHash.toHex(Redeemers.toScriptDataHashFromEncoded(new Uint8Array(0), datums, empty))).toBe(
      hx(expected)
    )
  })

  it("treats absent datums differently from empty ones", () => {
    const absent = ScriptDataHash.toHex(Redeemers.toScriptDataHashFromEncoded(new Uint8Array(0), undefined, empty))
    const present = ScriptDataHash.toHex(Redeemers.toScriptDataHashFromEncoded(new Uint8Array(0), datums, empty))
    expect(absent).not.toBe(present)
  })
})

describe("auxiliary data from encoded parts", () => {
  const metadata = Metadata.toCBORBytes()(Metadata.fromEntries([[674n, TransactionMetadatum.text("hi")]]))
  const nativeScript = NativeScripts.toCBORBytes(NativeScripts.makeScriptPubKey(B("aa".repeat(28))))

  it("keeps bare metadata in the Shelley form", () => {
    // ⚠️ The era form is part of `auxiliary_data_hash` and therefore of the transaction id. Always
    // writing Conway would change it for every metadata-only transaction, which is most of them.
    expect(AuxiliaryData.toCBORHex(AuxiliaryData.fromEncoded({ metadata }))).toBe(hx(metadata))
  })

  it("moves to the Conway form once scripts are present", () => {
    const conway = AuxiliaryData.toCBORHex(AuxiliaryData.fromEncoded({ metadata, nativeScripts: [nativeScript] }))
    expect(conway.startsWith("d90103")).toBe(true)
    expect(conway).toContain(hx(nativeScript))
  })

  it("uses the Conway form for scripts without metadata", () => {
    expect(AuxiliaryData.toCBORHex(AuxiliaryData.fromEncoded({ nativeScripts: [nativeScript] }))).toMatch(/^d90103/)
  })

  it("refuses to build nothing", () => {
    // A Shelley auxiliary_data IS its metadata map, so there is nothing to build without one — and
    // an empty one would hash over no metadata while claiming to cover it.
    expect(() => AuxiliaryData.fromEncoded({})).toThrow(/neither metadata nor native scripts/)
  })
})

describe("a signed transaction from encoded parts", () => {
  const bodyHex = TransactionBody.toCBORHex(
    TransactionBody.fromEncoded({ inputs: [B(inputHex)], outputs: [B(outputHex)], fee: 200_000n })
  )

  it("keeps the body bytes it was given", () => {
    const tx = Transaction.fromEncoded({ body: B(bodyHex), witnessSet: TransactionWitnessSet.empty() })
    expect(Transaction.toCBORHex(tx)).toContain(bodyHex)
  })

  it("keeps a BARE input set, which the encoder would otherwise re-tag", () => {
    // Babbage wrote the input set as a bare array and the ledger still accepts it. Re-tagging adds
    // three bytes and changes the transaction id — under a signature already covering the other.
    const bare = bodyHex.replace("a300d9010281", "a30081")
    expect(bare).not.toBe(bodyHex)
    const tx = Transaction.fromEncoded({ body: B(bare), witnessSet: TransactionWitnessSet.empty() })
    expect(Transaction.toCBORHex(tx)).toContain(bare)
  })

  it("defaults isValid to true, the only value a wallet submits", () => {
    const tx = Transaction.fromEncoded({ body: B(bodyHex), witnessSet: TransactionWitnessSet.empty() })
    expect(tx.isValid).toBe(true)
  })

  it("carries auxiliary data when given and null when not", () => {
    const metadata = Metadata.toCBORBytes()(Metadata.fromEntries([[674n, TransactionMetadatum.text("hi")]]))
    const aux = AuxiliaryData.toCBORBytes(AuxiliaryData.fromEncoded({ metadata }))
    const withAux = Transaction.fromEncoded({
      body: B(bodyHex),
      witnessSet: TransactionWitnessSet.empty(),
      auxiliaryData: aux
    })
    expect(withAux.auxiliaryData).not.toBeNull()
    expect(
      Transaction.fromEncoded({ body: B(bodyHex), witnessSet: TransactionWitnessSet.empty() }).auxiliaryData
    ).toBeNull()
  })
})

describe("splitMapEntries returns slices, never re-encodings", () => {
  const split = (hex: string) => CBOR.splitMapEntries(B(hex)).map(([k, v]) => [hx(k), hx(v)])

  it("reads a definite map", () => {
    expect(split(`a182000082${D10}820102`)).toEqual([["820000", `82${D10}820102`]])
  })

  it("reads an indefinite map", () => {
    expect(split("bf0001ff")).toEqual([["00", "01"]])
  })

  it("reads the empty forms", () => {
    expect(split("a0")).toEqual([])
    expect(split("bfff")).toEqual([])
  })

  it("refuses a value that is not a map", () => {
    expect(() => split("8001")).toThrow(/expected a map/)
  })

  it("refuses an unterminated indefinite map", () => {
    expect(() => split("bf0001")).toThrow(/not terminated/)
  })

  it("pairs with the encoder, so the two agree about a Plutus map's order", () => {
    // A Plutus map is NOT sorted: the order given is the order a script reading it sees.
    const entries: ReadonlyArray<readonly [Uint8Array, Uint8Array]> = [
      [B("182a"), B(D10)],
      [B("01"), B("80")]
    ]
    expect(CBOR.splitMapEntries(Data.spliceMap(entries)).map(([k, v]) => [hx(k), hx(v)])).toEqual([
      ["182a", D10],
      ["01", "80"]
    ])
  })
})
