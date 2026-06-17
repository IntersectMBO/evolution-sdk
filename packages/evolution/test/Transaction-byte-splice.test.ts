import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as CBOR from "../src/CBOR.js"
import * as PlutusData from "../src/Data.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"

// ---------------------------------------------------------------------------
// addVKeyWitnessesBytes — byte-level witness merging
//
// Operates directly on raw CBOR bytes. Only the vkey witnesses value (key 0)
// in the witness set map is modified. Everything else — body, redeemers,
// datums, scripts, isValid, auxData, map entry ordering — is preserved
// byte-for-byte.
// ---------------------------------------------------------------------------

const buildWalletWitnessBytes = (): Uint8Array => {
  const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[new Uint8Array(32).fill(0xaa), new Uint8Array(64).fill(0xbb)]] }))
  return CBOR.toCBORBytes(wsMap)
}

describe("addVKeyWitnessesBytes", () => {
  it("preserves body and tail bytes — only vkey witnesses value changes", () => {
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = Transaction.toCBORBytes(sampleTx)
    const txHex = Buffer.from(txBytes).toString("hex")

    const walletWsBytes = buildWalletWitnessBytes()
    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, walletWsBytes)
    const signedHex = Buffer.from(signedBytes).toString("hex")

    const hdr = (txBytes[0] & 0x1f) < 24 ? 1 : 2
    const { newOffset: bodyEnd } = CBOR.decodeItemWithOffset(txBytes, hdr)
    expect(signedHex.slice(hdr * 2, bodyEnd * 2)).toBe(txHex.slice(hdr * 2, bodyEnd * 2))

    const { newOffset: wsEnd } = CBOR.decodeItemWithOffset(txBytes, bodyEnd)
    const hdr2 = (signedBytes[0] & 0x1f) < 24 ? 1 : 2
    const { newOffset: bodyEnd2 } = CBOR.decodeItemWithOffset(signedBytes, hdr2)
    const { newOffset: wsEnd2 } = CBOR.decodeItemWithOffset(signedBytes, bodyEnd2)
    // tail bytes (isValid + auxData) must be identical in both
    expect(signedHex.slice(wsEnd2 * 2)).toBe(txHex.slice(wsEnd * 2))
  })

  it("preserves non-canonical body encoding (txId stable)", () => {
    // fee=0 encoded as 0x1800 (non-canonical)
    const nonCanonicalHex = "84a300d90102800180021800a0f5f6"
    const txBytes = Buffer.from(nonCanonicalHex, "hex")
    const signedBytes = Transaction.addVKeyWitnessesBytes(new Uint8Array(txBytes), buildWalletWitnessBytes())
    expect(Buffer.from(signedBytes).toString("hex")).toContain("a300d90102800180021800")
  })

  it("preserves redeemers bytes verbatim (scriptDataHash stable)", () => {
    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const bodyBytes = TransactionBody.toCBORBytes(sampleTx.body)

    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    const witnessMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    witnessMap.set(5n, redeemersMap)
    const witnessBytes = CBOR.toCBORBytes(witnessMap)

    const wsParsed = CBOR.fromCBORBytes(witnessBytes) as Map<bigint, CBOR.CBOR>
    const originalRedeemersHex = Buffer.from(CBOR.toCBORBytes(wsParsed.get(5n)!)).toString("hex")

    const txBytes = CBOR.encodeArrayAsDefinite([
      bodyBytes, witnessBytes, CBOR.internalEncodeSync(true), CBOR.internalEncodeSync(null)
    ])

    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, buildWalletWitnessBytes())
    const signedWsMap = (CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>

    expect(signedWsMap.get(5n)).toBeInstanceOf(Map)
    expect(Buffer.from(CBOR.toCBORBytes(signedWsMap.get(5n)!)).toString("hex")).toBe(originalRedeemersHex)
    expect(signedWsMap.get(0n)).toBeDefined()
  })

  it("preserves map entry ordering — new key 0 appended at end", () => {
    const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    wsMap.set(3n, CBOR.Tag.make({ tag: 258, value: [new Uint8Array([1, 2, 3])] }))
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [100n, 200n]] as unknown as CBOR.CBOR)
    wsMap.set(5n, redeemersMap)
    const wsBytes = CBOR.toCBORBytes(wsMap)

    const { count, hdrSize } = readMapHeader(wsBytes)
    let off = hdrSize
    const entryHexes: Array<string> = []
    for (let i = 0; i < count; i++) {
      const start = off
      const { newOffset: kEnd } = CBOR.decodeItemWithOffset(wsBytes, off)
      const { newOffset: vEnd } = CBOR.decodeItemWithOffset(wsBytes, kEnd)
      entryHexes.push(Buffer.from(wsBytes.slice(start, vEnd)).toString("hex"))
      off = vEnd
    }

    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = CBOR.encodeArrayAsDefinite([
      TransactionBody.toCBORBytes(sampleTx.body),
      wsBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, buildWalletWitnessBytes())
    const signedHex = Buffer.from(signedBytes).toString("hex")

    for (const entry of entryHexes) {
      expect(signedHex).toContain(entry)
    }

    const signedWsMap = (CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>
    expect([...signedWsMap.keys()]).toContain(0n)
    expect([...signedWsMap.keys()]).toContain(3n)
    expect([...signedWsMap.keys()]).toContain(5n)
  })

  it("splices in-place when key 0 already exists — merges witness arrays", () => {
    const wsMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    wsMap.set(0n, CBOR.Tag.make({ tag: 258, value: [[new Uint8Array(32).fill(0x11), new Uint8Array(64).fill(0x22)]] }))
    const constrData = PlutusData.constr(0n, [])
    const dataCBOR = CBOR.fromCBORBytes(PlutusData.toCBORBytes(constrData))
    const redeemersMap = new Map<CBOR.CBOR, CBOR.CBOR>()
    redeemersMap.set([0n, 0n] as unknown as CBOR.CBOR, [dataCBOR, [50n, 100n]] as unknown as CBOR.CBOR)
    wsMap.set(5n, redeemersMap)
    const wsBytes = CBOR.toCBORBytes(wsMap)

    const { count, hdrSize } = readMapHeader(wsBytes)
    let off = hdrSize
    let redeemersEntryHex = ""
    for (let i = 0; i < count; i++) {
      const start = off
      const { item: k, newOffset: kEnd } = CBOR.decodeItemWithOffset(wsBytes, off)
      const { newOffset: vEnd } = CBOR.decodeItemWithOffset(wsBytes, kEnd)
      if (k === 5n) redeemersEntryHex = Buffer.from(wsBytes.slice(start, vEnd)).toString("hex")
      off = vEnd
    }

    const [sampleTx] = FastCheck.sample(Transaction.arbitrary, 1)
    const txBytes = CBOR.encodeArrayAsDefinite([
      TransactionBody.toCBORBytes(sampleTx.body),
      wsBytes,
      CBOR.internalEncodeSync(true),
      CBOR.internalEncodeSync(null)
    ])

    const signedBytes = Transaction.addVKeyWitnessesBytes(txBytes, buildWalletWitnessBytes())
    const signedHex = Buffer.from(signedBytes).toString("hex")

    expect(signedHex).toContain(redeemersEntryHex)

    const signedWsMap = (CBOR.fromCBORBytes(signedBytes) as Array<CBOR.CBOR>)[1] as Map<bigint, CBOR.CBOR>
    const vkeys = unwrapVkeyArray(signedWsMap.get(0n))
    expect(vkeys.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Tag-258 certificates — Conway nonempty_oset<certificate>
// ---------------------------------------------------------------------------

// Real CIP-113 blacklist init tx with StakeRegistration certs wrapped in tag 258
const blInitHex = "84a900d90102818258207f3b0a9a0c20db10a819430d44af833290206782d638f8e4a1e9cfb38a293d220301838258390032e7e00eae28502a2aa271cf4202b1b01b94ca8efe642e380c93d5e20510c0ce8306f183c94d1636f64f6214b774bb9f88852c6acf4279241a02625a00a300581d70ad2d62ea877ba77944faaece81fef01f92dd0b5eff03fa22f11805a701821a00124864a1581c71965aaea37d672506d902aa970816998ea320de6cdd092a261d21daa14001028201d8185825d8799f40581effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8258390032e7e00eae28502a2aa271cf4202b1b01b94ca8efe642e380c93d5e20510c0ce8306f183c94d1636f64f6214b774bb9f88852c6acf4279241af662a97c021a000466de04d901028282008201581cfab69fea52a375ec93576b049f17a7ee0295ab7c33b1b4c34553a54f82008201581c03d945b4f2ee047fdc826d216764508a2bc96b71ee16506ca0ec5ff609a1581c71965aaea37d672506d902aa970816998ea320de6cdd092a261d21daa140010b58200dbd65dd893a3760e04a32ecc98a737a2b71684c5d4e91d0d3322456e8f079950dd901028182582065f0e8c149f0bb18a4f8bd7f93ca3d78dd363790412d4fc006e156c8cc37b85c02108258390032e7e00eae28502a2aa271cf4202b1b01b94ca8efe642e380c93d5e20510c0ce8306f183c94d1636f64f6214b774bb9f88852c6acf4279241aac92b144111a00069a4da205a182010082d87980821a000299ee1a0311a68707d90102815907e95907e6010100332229800aba2aba1aba0aab9faab9eaab9dab9a9bae0024888888896600264653001300900198049805000cdc3a400130090024888966002600460126ea800e33001375c601a60146ea800e6e1d20029b874801260126ea80112222325980098038014566002601e6ea8026003164041159800980200144c8c966002602a0050038b2024375c6026002601e6ea80262b30013003002899192cc004c05400a0071640486eb8c04c004c03cdd5004c5900d201a4034330012301230130019180918099809800cdc02400523012301330133013301300191191919800800802112cc00400600713233225980099b910070028acc004cdc78038014400600c80a226600a00a603400880a0dd718098009bab301400130160014050297adef6c60912cc004c020c03cdd500144c8c8cc896600260300070058b202a375c602a0026eb8c054008c054004c040dd500145900e488c8cc00400400c896600200314bd7044cc050c00cc054004cc008008c05800501348c048c04cc04cc04cc04cc04cc04cc04cc04c00644646600200200644b30010018a508acc004c00cdd7180a800c528c4cc008008c058005010202698069baa008911919800800801912cc00400629422b3001300330150018a51899801001180b000a020404c911111111114c004cc88cc896600200513301f4c10180003301f374e00297ae08992cc004c8cc00400400c896600200314a315980099baf302330203754604600200713300200230240018a504078810a2660406e9c00ccc080dd380125eb822c80e0c080c074dd51807980e9baa30200024078660046eb0c078c06cdd50091198011bab300e301c3754601c60386ea8004048cc008dd61806180d9baa0122330023756601c60386ea800404888c8cc00400400c896600200314bd7044cc8966002600a00513302100233004004001899802002000a03a30200013021001407844646600200200644b30010018a508992cc004cdc8802000c4cdc7802000c4cc00c00cc08800901c1bae301c302000140792259800800c520008980599801001180f800a038912cc0040062900044c02ccc008008c07c00501c48c966002601e60346ea80062603c60366ea80062c80c8c02cc068dd5000c888c8cc88cc008008004896600200300389919912cc004cdc8803801456600266e3c01c00a20030064081133005005302600440806eb8c07c004dd698100009811000a0403300b0040031480012222298009bac30210059bac3021302200598020024c00c00e444602d3001003801400500424444464b3001301c00d8acc004cc030dd6181398121baa01b23375e6050604a6ea80040b22b300130280058992cc0056600200f14a314a081322b30013371e6eb8c0a0c094dd5000a441008acc004cdc79bae30173025375400291011effffffffffffffffffffffffffffffffffffffffffffffffffffffffffff008cc004dd5980a18129baa01c80dd220100400d14a0811a29410234528204633001302700501a8b204a8b20448acc004c06403626644b3001302a0088991980a0008992cc004cdc39b8d004480e22b30010038acc00660026eacc05cc0a0dd500fc07a00880322b3001337206eb8c0acc0a0dd5001002456600266e40010dd7180d18141baa0028acc004c070c0200062b30013301000125980099b8f375c605860526ea8004dd7181618149baa003899b8f375c603660526ea8004016294102744cc04000496600266e3cdd7181618149baa001005899b8f375c603660526ea8004dd7180d98149baa0038a50409d14a0813229410264528204c8a50409914a0813229410264528204c3301300823300500101e300a301830263754605201116409c6eb8c09cc090dd500f198071bac300f30243754036466e3c00408a2646644b3001302b002899912cc004c0b402a264b3001330143758602a60546ea80848cdc7800814456600266e1e60026eacc064c0a8dd5010c082008806920018acc004c078c0280322b30013371e6eb8c0b4c0a8dd5001802456600266e3cdd7181698151baa001375c605a60546ea800a2b30013371e6eb8c070c0a8dd50009bae301c302a375400713371e6eb8c070c0a8dd5001002452820508a5040a115980099b8f375c605a60546ea80080122b30013371e6eb8c0b4c0a8dd50009bae302d302a375400715980099b8f375c603860546ea8004dd7180e18151baa002899b8f375c603860546ea800c0122941028452820508b205040a114a0814229410284528205033006302c00a01f8b2054302a003302a0028b20503029001375c6050604a6ea807ccc0400188c8cc04c0044004c024c05cc094dd5000a04440884464b3001301a32330010010022259800800c52000899914c004dd718148014dd598150014896600200310038991991180f9980280298198021bae302c001375a605a002605e0028169222330010010021815800998010011816000a0528992cc004c070c0180062646602a0022b3001337206eb8c0acc0a0dd50009bae301a30283754003159800981600144c8c966002603e6eb4c0a800a2b30015980099b8f001375c605a60546ea800e2946266e3c00522010040a110038b20508b2050375c605000260560051640a51640986016009164094660280020051640906eacc05cc094dd500104590080c024004c010dd5004c52689b2b2004260127d8799f58207f3b0a9a0c20db10a819430d44af833290206782d638f8e4a1e9cfb38a293d2203ff004c011e581c32e7e00eae28502a2aa271cf4202b1b01b94ca8efe642e380c93d5e20001f5f6"

describe("tag-258 certificates", () => {
  it("deserializes tx with tag-258 wrapped certificates", () => {
    const tx = Transaction.fromCBORHex(blInitHex)
    expect(tx.body).toBeDefined()
    expect(tx.body.certificates).toBeDefined()
    expect(tx.body.certificates!.length).toBe(2)
    expect(tx.body.certificates![0]._tag).toBe("StakeRegistration")
    expect(tx.body.certificates![1]._tag).toBe("StakeRegistration")
  })

  it("deserializes tx body with untagged (Babbage) certificates array", () => {
    // Derive an untagged-cert body from the real Conway body by unwrapping tag 258 at key 4.
    const tx = Transaction.fromCBORHex(blInitHex)
    const txCBOR = CBOR.fromCBORBytes(Transaction.toCBORBytes(tx)) as Array<CBOR.CBOR>
    const bodyMap = txCBOR[0] as Map<bigint, CBOR.CBOR>
    const certsRaw = bodyMap.get(4n)
    expect(CBOR.isTag(certsRaw as CBOR.CBOR)).toBe(true)
    const certsArray = (certsRaw as { _tag: "Tag"; tag: number; value: Array<CBOR.CBOR> }).value
    bodyMap.set(4n, certsArray)
    const bodyBytes = CBOR.toCBORBytes(bodyMap)

    const decoded = TransactionBody.fromCBORBytes(bodyBytes)
    expect(decoded.certificates).toBeDefined()
    expect(decoded.certificates!.length).toBe(2)
    expect(decoded.certificates![0]._tag).toBe("StakeRegistration")
  })

  it("re-encodes certificates wrapped in tag 258", () => {
    const tx = Transaction.fromCBORHex(blInitHex)
    const reBodyBytes = TransactionBody.toCBORBytes(tx.body)
    const reBody = CBOR.fromCBORBytes(reBodyBytes) as Map<bigint, CBOR.CBOR>
    const certsField = reBody.get(4n)
    expect(CBOR.isTag(certsField as CBOR.CBOR)).toBe(true)
    const tagged = certsField as { _tag: "Tag"; tag: number; value: unknown }
    expect(tagged.tag).toBe(258)
    expect(Array.isArray(tagged.value)).toBe(true)
    expect((tagged.value as Array<unknown>).length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMapHeader(data: Uint8Array): { count: number; hdrSize: number } {
  const ai = data[0] & 0x1f
  if (ai < 24) return { count: ai, hdrSize: 1 }
  if (ai === 24) return { count: data[1], hdrSize: 2 }
  if (ai === 25) return { count: (data[1] << 8) | data[2], hdrSize: 3 }
  throw new Error(`Unsupported map header additionalInfo: ${ai}`)
}

function unwrapVkeyArray(val: CBOR.CBOR | undefined): Array<CBOR.CBOR> {
  if (val === undefined) return []
  if (CBOR.isTag(val)) {
    const tag = val as { _tag: "Tag"; tag: number; value: unknown }
    if (tag.tag === 258 && Array.isArray(tag.value)) return tag.value as Array<CBOR.CBOR>
  }
  if (Array.isArray(val)) return val as Array<CBOR.CBOR>
  return []
}
