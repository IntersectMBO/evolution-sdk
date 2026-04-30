/**
 * Cbor — unified test suite for the CBOR byte layer.
 *
 * CborWriter: pre-allocated buffer encoder
 * CborReader: cursor-based decoder with annotated methods
 * CborWriter preserve: format preservation via object identity
 */

import { describe, expect, it } from "@effect/vitest"

import * as Bytes from "../Bytes.js"
import { CborReader } from "./CborReader.js"
import { CANONICAL, capture, CborWriter, CML, type FieldFormat,getFieldFormat, getFormat, getPreserved, PLUTUS_DATA, propagateHint } from "./CborWriter.js"

// ============================================================================
// Helpers
// ============================================================================

const encode = (write: (w: CborWriter) => void): Uint8Array => {
  const w = new CborWriter()
  write(w)
  return w.finish()
}

// ============================================================================
// CborReader: indefinite arrays
// ============================================================================

describe("CborReader: indefinite arrays", () => {
  it("reads indefinite array [1, 2, 3]", () => {
    const bytes = new Uint8Array([0x9f, 0x01, 0x02, 0x03, 0xff])
    const r = new CborReader(bytes)
    const count = r.readArrayHeader()
    expect(count).toBe(-1)

    const items: Array<bigint> = []
    while (!r.isBreak()) items.push(r.readUint())
    expect(items).toEqual([1n, 2n, 3n])
  })

  it("reads definite array [1, 2]", () => {
    const bytes = new Uint8Array([0x82, 0x01, 0x02])
    const r = new CborReader(bytes)
    const count = r.readArrayHeader()
    expect(count).toBe(2)
    expect(r.readUint()).toBe(1n)
    expect(r.readUint()).toBe(2n)
  })

  it("reads empty indefinite array", () => {
    const bytes = new Uint8Array([0x9f, 0xff])
    const r = new CborReader(bytes)
    expect(r.readArrayHeader()).toBe(-1)
    expect(r.isBreak()).toBe(true)
  })
})

// ============================================================================
// CborReader: indefinite maps
// ============================================================================

describe("CborReader: indefinite maps", () => {
  it("reads indefinite map {1: 2, 3: 4}", () => {
    const bytes = new Uint8Array([0xbf, 0x01, 0x02, 0x03, 0x04, 0xff])
    const r = new CborReader(bytes)
    const count = r.readMapHeader()
    expect(count).toBe(-1)

    const entries: Array<[bigint, bigint]> = []
    while (!r.isBreak()) entries.push([r.readUint(), r.readUint()])
    expect(entries).toEqual([[1n, 2n], [3n, 4n]])
  })

  it("reads definite map {1: 2}", () => {
    const bytes = new Uint8Array([0xa1, 0x01, 0x02])
    const r = new CborReader(bytes)
    expect(r.readMapHeader()).toBe(1)
    expect(r.readUint()).toBe(1n)
    expect(r.readUint()).toBe(2n)
  })
})

// ============================================================================
// CborReader: skip handles indefinite containers
// ============================================================================

describe("CborReader: skip handles indefinite containers", () => {
  it("skips indefinite array", () => {
    const bytes = new Uint8Array([0x9f, 0x01, 0x02, 0xff, 0x18, 0x63])
    const r = new CborReader(bytes)
    r.skip()
    expect(r.readUint()).toBe(99n)
  })

  it("skips indefinite map", () => {
    const bytes = new Uint8Array([0xbf, 0x01, 0x02, 0xff, 0x18, 0x2a])
    const r = new CborReader(bytes)
    r.skip()
    expect(r.readUint()).toBe(42n)
  })

  it("skips nested indefinite structures", () => {
    const bytes = new Uint8Array([0x9f, 0xbf, 0x01, 0x02, 0xff, 0xff, 0x07])
    const r = new CborReader(bytes)
    r.skip()
    expect(r.readUint()).toBe(7n)
  })
})

// ============================================================================
// CborReader: CborWriter roundtrip
// ============================================================================

describe("CborReader: CborWriter roundtrip", () => {
  it("reads indefinite array from CborWriter", () => {
    const bytes = encode((w) => {
      w.writeIndefiniteArrayHeader()
      w.writeUint(1n)
      w.writeUint(2n)
      w.writeUint(3n)
      w.writeBreak()
    })

    const r = new CborReader(bytes)
    const count = r.readArrayHeader()
    expect(count).toBe(-1)

    const items: Array<bigint> = []
    while (!r.isBreak()) items.push(r.readUint())
    expect(items).toEqual([1n, 2n, 3n])
  })

  it("reads indefinite map from CborWriter", () => {
    const bytes = encode((w) => {
      w.writeIndefiniteMapHeader()
      w.writeUint(0n); w.writeUint(10n)
      w.writeUint(1n); w.writeUint(20n)
      w.writeBreak()
    })

    const r = new CborReader(bytes)
    const count = r.readMapHeader()
    expect(count).toBe(-1)

    const entries: Array<[bigint, bigint]> = []
    while (!r.isBreak()) entries.push([r.readUint(), r.readUint()])
    expect(entries).toEqual([[0n, 10n], [1n, 20n]])
  })
})

// ============================================================================
// CborReader: indefinite byte strings
// ============================================================================

describe("CborReader: indefinite byte strings", () => {
  it("reads indefinite byte string (two chunks)", () => {
    const bytes = new Uint8Array([0x5f, 0x42, 0x01, 0x02, 0x41, 0x03, 0xff])
    const r = new CborReader(bytes)
    const result = r.readBytes()
    expect(result).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
  })

  it("reads empty indefinite byte string", () => {
    const bytes = new Uint8Array([0x5f, 0xff])
    const r = new CborReader(bytes)
    expect(r.readBytes()).toEqual(new Uint8Array([]))
  })

  it("skip handles indefinite byte string", () => {
    const bytes = new Uint8Array([0x5f, 0x42, 0x01, 0x02, 0xff, 0x05])
    const r = new CborReader(bytes)
    r.skip()
    expect(r.readUint()).toBe(5n)
  })
})

// ============================================================================
// CborReader: indefinite text strings
// ============================================================================

describe("CborReader: indefinite text strings", () => {
  it("reads indefinite text string (two chunks)", () => {
    const bytes = new Uint8Array([0x7f, 0x61, 0x61, 0x62, 0x62, 0x63, 0xff])
    const r = new CborReader(bytes)
    expect(r.readText()).toBe("abc")
  })

  it("reads empty indefinite text string", () => {
    const bytes = new Uint8Array([0x7f, 0xff])
    const r = new CborReader(bytes)
    expect(r.readText()).toBe("")
  })

  it("skip handles indefinite text string", () => {
    const bytes = new Uint8Array([0x7f, 0x61, 0x61, 0xff, 0x07])
    const r = new CborReader(bytes)
    r.skip()
    expect(r.readUint()).toBe(7n)
  })
})

// ============================================================================
// CborReader: readBytes vs readBytesView
// ============================================================================

describe("CborReader: readBytes vs readBytesView", () => {
  it("readBytes returns a copy — safe from mutation", () => {
    const data = new Uint8Array([0x43, 0xaa, 0xbb, 0xcc])
    const r = new CborReader(data)
    const copy = r.readBytes()
    data[1] = 0xff
    expect(copy[0]).toBe(0xaa)
  })

  it("readBytesView returns a view — affected by mutation", () => {
    const data = new Uint8Array([0x43, 0xaa, 0xbb, 0xcc])
    const r = new CborReader(data)
    const view = r.readBytesView()
    data[1] = 0xff
    expect(view[0]).toBe(0xff)
  })
})

// ============================================================================
// CborReader: annotated methods
// ============================================================================

describe("CborReader: annotated methods", () => {
  it("readUintAnnotated — inline value", () => {
    const r = new CborReader(new Uint8Array([0x05]))
    const [value, width] = r.readUintAnnotated()
    expect(value).toBe(5n)
    expect(width).toBe(0)
  })

  it("readUintAnnotated — 1-byte non-minimal", () => {
    const r = new CborReader(new Uint8Array([0x18, 0x00]))
    const [value, width] = r.readUintAnnotated()
    expect(value).toBe(0n)
    expect(width).toBe(1)
  })

  it("readUintAnnotated — 2-byte width", () => {
    const r = new CborReader(new Uint8Array([0x19, 0x00, 0x2a]))
    const [value, width] = r.readUintAnnotated()
    expect(value).toBe(42n)
    expect(width).toBe(2)
  })

  it("readArrayHeaderAnnotated — indefinite", () => {
    const r = new CborReader(new Uint8Array([0x9f, 0x01, 0xff]))
    const [count, fmt] = r.readArrayHeaderAnnotated()
    expect(count).toBe(-1)
    expect(fmt.indefinite).toBe(true)
  })

  it("readArrayHeaderAnnotated — definite", () => {
    const r = new CborReader(new Uint8Array([0x82, 0x01, 0x02]))
    const [count, fmt] = r.readArrayHeaderAnnotated()
    expect(count).toBe(2)
    expect(fmt.indefinite).toBe(false)
    expect(fmt.headerWidth).toBe(0)
  })

  it("readMapHeaderAnnotated — definite 1-byte width", () => {
    // 0x98 is array, 0xb8 is map with 1-byte count
    const r = new CborReader(new Uint8Array([0xb8, 0x02, 0x01, 0x02, 0x03, 0x04]))
    const [count, fmt] = r.readMapHeaderAnnotated()
    expect(count).toBe(2)
    expect(fmt.headerWidth).toBe(1)
  })

  it("readTagHeaderAnnotated — tag 258", () => {
    const r = new CborReader(new Uint8Array([0xd9, 0x01, 0x02, 0x80]))
    const [tag, width] = r.readTagHeaderAnnotated()
    expect(tag).toBe(258)
    expect(width).toBe(2)
  })

  it("readBytesAnnotated — definite", () => {
    const r = new CborReader(new Uint8Array([0x43, 0x01, 0x02, 0x03]))
    const [data, fmt] = r.readBytesAnnotated()
    expect(data).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
    expect(fmt.indefinite).toBe(false)
  })

  it("readBytesAnnotated — indefinite with chunks", () => {
    const r = new CborReader(new Uint8Array([0x5f, 0x42, 0x01, 0x02, 0x41, 0x03, 0xff]))
    const [data, fmt] = r.readBytesAnnotated()
    expect(data).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
    expect(fmt.indefinite).toBe(true)
    expect(fmt.chunks).toEqual([2, 1])
  })

  it("readTextAnnotated — indefinite with chunks", () => {
    const r = new CborReader(new Uint8Array([0x7f, 0x61, 0x61, 0x62, 0x62, 0x63, 0xff]))
    const [text, fmt] = r.readTextAnnotated()
    expect(text).toBe("abc")
    expect(fmt.indefinite).toBe(true)
    expect(fmt.chunks).toEqual([1, 2])
  })

  it("readNintAnnotated — 1-byte width", () => {
    // -1 as 1-byte nint: 0x38 0x00
    const r = new CborReader(new Uint8Array([0x38, 0x00]))
    const [value, width] = r.readNintAnnotated()
    expect(value).toBe(-1n)
    expect(width).toBe(1)
  })
})

// ============================================================================
// Encoding profiles
// ============================================================================

describe("Encoding profiles", () => {
  it("CML profile: definite containers", () => {
    const arr = [1n, 2n, 3n]
    const bytes = encode((w) => w.writeArrayWithProfile(arr, (el) => w.writeUint(el), CML))
    expect(bytes[0]).toBe(0x83) // definite array(3)
  })

  it("PLUTUS_DATA profile: indefinite containers", () => {
    const arr = [1n, 2n]
    const bytes = encode((w) => w.writeArrayWithProfile(arr, (el) => w.writeUint(el), PLUTUS_DATA))
    expect(bytes[0]).toBe(0x9f) // indefinite array
    expect(bytes[bytes.length - 1]).toBe(0xff) // break
  })

  it("format hint overrides profile", () => {
    const arr = [1n, 2n]
    capture(arr, undefined, { indefinite: true }) // decoded as indefinite
    // Even with CML profile (definite), hint wins
    const bytes = encode((w) => w.writeArrayWithProfile(arr, (el) => w.writeUint(el), CML))
    expect(bytes[0]).toBe(0x9f) // indefinite from hint
  })

  it("CANONICAL profile: sorted map keys", () => {
    const w = new CborWriter()
    const entries = [
      { key: 5n, writeKey: () => w.writeUint(5n), writeValue: () => w.writeUint(50n) },
      { key: 0n, writeKey: () => w.writeUint(0n), writeValue: () => w.writeUint(10n) },
      { key: 2n, writeKey: () => w.writeUint(2n), writeValue: () => w.writeUint(20n) },
    ]
    w.writeMapWithProfile(entries, CANONICAL)
    const bytes = w.finish()

    const r = new CborReader(bytes)
    r.readMapHeader()
    expect(r.readUint()).toBe(0n)
    r.skip()
    expect(r.readUint()).toBe(2n)
    r.skip()
    expect(r.readUint()).toBe(5n)
  })

  it("CML profile: insertion-order map keys", () => {
    const w = new CborWriter()
    const entries = [
      { key: 5n, writeKey: () => w.writeUint(5n), writeValue: () => w.writeUint(50n) },
      { key: 0n, writeKey: () => w.writeUint(0n), writeValue: () => w.writeUint(10n) },
    ]
    w.writeMapWithProfile(entries, CML)
    const bytes = w.finish()

    const r = new CborReader(bytes)
    r.readMapHeader()
    expect(r.readUint()).toBe(5n)
    r.skip()
    expect(r.readUint()).toBe(0n)
  })

  it("PLUTUS_DATA profile: indefinite map", () => {
    const w = new CborWriter()
    const entries = [
      { key: 0n, writeKey: () => w.writeUint(0n), writeValue: () => w.writeUint(10n) },
    ]
    w.writeMapWithProfile(entries, PLUTUS_DATA)
    const bytes = w.finish()
    expect(bytes[0]).toBe(0xbf) // indefinite map
    expect(bytes[bytes.length - 1]).toBe(0xff) // break
  })

  it("keyOrder from hint takes priority over sortMapKeys", () => {
    const sourceMap = {}
    capture(sourceMap, undefined, { indefinite: false, keyOrder: [5n, 0n] })

    const w = new CborWriter()
    const entries = [
      { key: 5n, writeKey: () => w.writeUint(5n), writeValue: () => w.writeUint(50n) },
      { key: 0n, writeKey: () => w.writeUint(0n), writeValue: () => w.writeUint(10n) },
    ]
    w.writeMapWithProfile(entries, CANONICAL, sourceMap)
    const bytes = w.finish()

    const r = new CborReader(bytes)
    r.readMapHeader()
    expect(r.readUint()).toBe(5n)
  })
})

// ============================================================================
// CborWriter preserve: domain types for preservation tests
// ============================================================================

class TxHash { constructor(readonly hash: Uint8Array) {} }
class TxInput { constructor(readonly txId: TxHash, readonly index: bigint) {} }
class VKeyWitness { constructor(readonly vkey: Uint8Array, readonly sig: Uint8Array) {} }
class WitnessSet { constructor(readonly vkeyWitnesses: ReadonlyArray<VKeyWitness>) {} }
class Transaction {
  constructor(
    readonly body: TxBody,
    readonly witnessSet: WitnessSet,
    readonly isValid: boolean,
  ) {}
}
class TxBody {
  constructor(
    readonly inputs: ReadonlyArray<TxInput>,
    readonly fee: bigint,
  ) {}
}

const writeTxHash = (w: CborWriter, v: TxHash): void => w.writeBytes(v.hash)
const writeTxInput = (w: CborWriter, v: TxInput): void => {
  w.writeDefiniteArrayHeader(2); writeTxHash(w, v.txId); w.writeUint(v.index)
}
const writeVKeyWitness = (w: CborWriter, v: VKeyWitness): void => {
  w.writeDefiniteArrayHeader(2); w.writeBytes(v.vkey); w.writeBytes(v.sig)
}
const writeTxBody = (w: CborWriter, v: TxBody): void => {
  w.writeDefiniteMapHeader(2)
  w.writeUint(0n); w.writeDefiniteArrayHeader(v.inputs.length)
  for (const inp of v.inputs) writeTxInput(w, inp)
  w.writeUint(2n); w.writeUint(v.fee)
}
const writeWitnessSet = (w: CborWriter, v: WitnessSet): void => {
  w.writeDefiniteMapHeader(1)
  w.writeUint(0n)
  w.writeArray(v.vkeyWitnesses, (vk) =>
    w.writePreserved(vk, () => writeVKeyWitness(w, vk))
  )
}
const writeTransaction = (w: CborWriter, v: Transaction): void => {
  w.writeDefiniteArrayHeader(3)
  w.writePreserved(v.body, () => writeTxBody(w, v.body))
  w.writePreserved(v.witnessSet, () => writeWitnessSet(w, v.witnessSet))
  w.writeBool(v.isValid)
}

const readTxHash = (r: CborReader): TxHash => new TxHash(r.readBytes())
const readTxInput = (r: CborReader): TxInput => {
  const start = r.position()
  r.readArrayHeader()
  const inp = new TxInput(readTxHash(r), r.readUint())
  capture(inp, r.buffer().subarray(start, r.position()))
  return inp
}
const readVKeyWitness = (r: CborReader): VKeyWitness => {
  const start = r.position()
  r.readArrayHeader()
  const vk = new VKeyWitness(r.readBytes(), r.readBytes())
  capture(vk, r.buffer().subarray(start, r.position()))
  return vk
}
const readTxBody = (r: CborReader): TxBody => {
  const start = r.position()
  const count = r.readMapHeader()
  let inputs: ReadonlyArray<TxInput> = []
  let fee = 0n
  for (let i = 0; i < count; i++) {
    const key = r.readUint()
    switch (key) {
      case 0n: {
        const len = r.readArrayHeader()
        const arr = new Array<TxInput>(len)
        for (let j = 0; j < len; j++) arr[j] = readTxInput(r)
        inputs = arr
        break
      }
      case 2n: fee = r.readUint(); break
      default: r.skip()
    }
  }
  const body = new TxBody(inputs, fee)
  capture(body, r.buffer().subarray(start, r.position()))
  return body
}
const readWitnessSet = (r: CborReader): WitnessSet => {
  const start = r.position()
  const count = r.readMapHeader()
  let vkeys: Array<VKeyWitness> = []
  for (let i = 0; i < count; i++) {
    const key = r.readUint()
    switch (key) {
      case 0n: {
        const byte = r.peekByte()
        const indefinite = (byte & 0x1f) === 31
        const len = indefinite ? 0 : r.readArrayHeader()
        vkeys = new Array<VKeyWitness>(len)
        for (let j = 0; j < len; j++) vkeys[j] = readVKeyWitness(r)
        capture(vkeys as unknown as object, undefined, { indefinite })
        break
      }
      default: r.skip()
    }
  }
  const ws = new WitnessSet(vkeys)
  capture(ws, r.buffer().subarray(start, r.position()))
  return ws
}
const readTransaction = (r: CborReader): Transaction => {
  r.readArrayHeader()
  const body = readTxBody(r)
  const witnessSet = readWitnessSet(r)
  const isValid = r.readBool()
  return new Transaction(body, witnessSet, isValid)
}

const decodeTx = (bytes: Uint8Array): Transaction => {
  const r = new CborReader(bytes)
  return readTransaction(r)
}
const bodyHex = (txBytes: Uint8Array): string => {
  const r = new CborReader(txBytes)
  r.readArrayHeader()
  const bodyStart = r.position()
  r.skip()
  return Bytes.toHex(txBytes.subarray(bodyStart, r.position()))
}

// ============================================================================
// CborWriter preserve: body byte preservation
// ============================================================================

describe("CborWriter preserve: body byte preservation", () => {
  const tx = new Transaction(
    new TxBody(
      [new TxInput(new TxHash(new Uint8Array(32).fill(0xab)), 42n)],
      200000n
    ),
    new WitnessSet([
      new VKeyWitness(new Uint8Array(32).fill(0xcc), new Uint8Array(64).fill(0xdd))
    ]),
    true
  )

  it("basic encode -> decode -> re-encode roundtrip", () => {
    const bytes = encode((w) => writeTransaction(w, tx))
    const decoded = decodeTx(bytes)
    const reEncoded = encode((w) => writeTransaction(w, decoded))
    expect(reEncoded).toEqual(bytes)
  })

  it("body bytes preserved after adding witness", () => {
    const bytes = encode((w) => writeTransaction(w, tx))
    const originalBodyHex = bodyHex(bytes)

    const decoded = decodeTx(bytes)

    const newWitness = new VKeyWitness(new Uint8Array(32).fill(0xee), new Uint8Array(64).fill(0xff))
    const oldVkeys = decoded.witnessSet.vkeyWitnesses
    const newVkeys = [...oldVkeys, newWitness]
    propagateHint(oldVkeys, newVkeys)

    const modifiedTx = new Transaction(
      decoded.body,
      new WitnessSet(newVkeys),
      decoded.isValid
    )

    const reEncoded = encode((w) => writeTransaction(w, modifiedTx))
    expect(bodyHex(reEncoded)).toBe(originalBodyHex)
  })

  it("old witnesses preserved, new witness encoded fresh", () => {
    const bytes = encode((w) => writeTransaction(w, tx))
    const decoded = decodeTx(bytes)

    const oldVk = decoded.witnessSet.vkeyWitnesses[0]
    const oldVkBytes = encode((w) => writeVKeyWitness(w, oldVk))

    const newVk = new VKeyWitness(new Uint8Array(32).fill(0x11), new Uint8Array(64).fill(0x22))
    const newVkeys = [...decoded.witnessSet.vkeyWitnesses, newVk]
    propagateHint(decoded.witnessSet.vkeyWitnesses, newVkeys)

    const modifiedTx = new Transaction(decoded.body, new WitnessSet(newVkeys), decoded.isValid)
    const reEncoded = encode((w) => writeTransaction(w, modifiedTx))

    const reParsed = decodeTx(reEncoded)
    const reVk0Bytes = encode((w) => writeVKeyWitness(w, reParsed.witnessSet.vkeyWitnesses[0]))

    expect(reVk0Bytes).toEqual(oldVkBytes)
  })

  it("non-canonical body encoding preserved", () => {
    const nonCanonicalBody = new Uint8Array([
      0xa2,
      0x00,
      0x81,
      0x82,
      0x58, 0x20,
      ...new Uint8Array(32).fill(0xab),
      0x18, 0x2a,       // uint(42) non-minimal
      0x02,
      0x18, 0x00,       // uint(0) NON-CANONICAL
    ])
    const nonCanonicalTx = new Uint8Array([
      0x83,
      ...nonCanonicalBody,
      0xa1, 0x00, 0x80,
      0xf5,
    ])

    const originalBodyHex = Bytes.toHex(nonCanonicalBody)

    const decoded = decodeTx(nonCanonicalTx)
    const modifiedTx = new Transaction(
      decoded.body,
      new WitnessSet([
        new VKeyWitness(new Uint8Array(32).fill(0xaa), new Uint8Array(64).fill(0xbb))
      ]),
      decoded.isValid
    )

    const reEncoded = encode((w) => writeTransaction(w, modifiedTx))
    expect(bodyHex(reEncoded)).toBe(originalBodyHex)
  })
})

// ============================================================================
// CborWriter preserve: container hint propagation
// ============================================================================

describe("CborWriter preserve: container hint propagation", () => {
  it("indefinite array style propagated to new array", () => {
    const original = [1, 2, 3]
    capture(original, undefined, { indefinite: true })

    const modified = [...original, 4]
    propagateHint(original, modified)

    const bytes = encode((w) => w.writeArray(modified, (el) => w.writeUint(BigInt(el as number))))

    expect(bytes[0]).toBe(0x9f)
    expect(bytes[bytes.length - 1]).toBe(0xff)
  })

  it("definite array stays definite", () => {
    const original = [1, 2]
    capture(original, undefined, { indefinite: false })

    const modified = [...original, 3]
    propagateHint(original, modified)

    const bytes = encode((w) => w.writeArray(modified, (el) => w.writeUint(BigInt(el as number))))

    expect(bytes[0]).toBe(0x83)
  })
})

// ============================================================================
// CborWriter preserve edge: redeemers preserved inside re-encoded witness set
// ============================================================================

describe("CborWriter preserve edge: redeemers preserved inside re-encoded witness set", () => {
  class EdgeRedeemer { constructor(readonly data: Uint8Array) {} }
  class EdgeVKey { constructor(readonly key: Uint8Array) {} }
  class EdgeWitnessSet {
    constructor(
      readonly vkeys: ReadonlyArray<EdgeVKey>,
      readonly redeemers: ReadonlyArray<EdgeRedeemer>,
    ) {}
  }

  const writeEdgeRedeemer = (w: CborWriter, r: EdgeRedeemer): void => {
    w.writeDefiniteArrayHeader(1); w.writeBytes(r.data)
  }
  const writeEdgeVKey = (w: CborWriter, v: EdgeVKey): void => {
    w.writeDefiniteArrayHeader(1); w.writeBytes(v.key)
  }
  const writeEdgeWitnessSet = (w: CborWriter, ws: EdgeWitnessSet): void => {
    w.writeDefiniteMapHeader(2)
    w.writeUint(0n)
    w.writeArray(ws.vkeys, (v) => w.writePreserved(v, () => writeEdgeVKey(w, v)))
    w.writeUint(5n)
    w.writeArray(ws.redeemers, (r) => w.writePreserved(r, () => writeEdgeRedeemer(w, r)))
  }

  const readEdgeRedeemer = (r: CborReader): EdgeRedeemer => {
    const start = r.position()
    r.readArrayHeader()
    const red = new EdgeRedeemer(r.readBytes())
    capture(red, r.buffer().subarray(start, r.position()))
    return red
  }
  const readEdgeVKey = (r: CborReader): EdgeVKey => {
    const start = r.position()
    r.readArrayHeader()
    const v = new EdgeVKey(r.readBytes())
    capture(v, r.buffer().subarray(start, r.position()))
    return v
  }
  const readEdgeWitnessSet = (bytes: Uint8Array): EdgeWitnessSet => {
    const r = new CborReader(bytes)
    const count = r.readMapHeader()
    let vkeys: Array<EdgeVKey> = []
    let redeemers: Array<EdgeRedeemer> = []
    for (let i = 0; i < count; i++) {
      const key = r.readUint()
      switch (key) {
        case 0n: {
          const len = r.readArrayHeader()
          vkeys = new Array(len)
          for (let j = 0; j < len; j++) vkeys[j] = readEdgeVKey(r)
          capture(vkeys as unknown as object, undefined, { indefinite: false })
          break
        }
        case 5n: {
          const len = r.readArrayHeader()
          redeemers = new Array(len)
          for (let j = 0; j < len; j++) redeemers[j] = readEdgeRedeemer(r)
          capture(redeemers as unknown as object, undefined, { indefinite: false })
          break
        }
        default: r.skip()
      }
    }
    return new EdgeWitnessSet(vkeys, redeemers)
  }

  it("redeemer bytes survive adding a vkey witness", () => {
    const original = new EdgeWitnessSet(
      [new EdgeVKey(new Uint8Array(32).fill(0xaa))],
      [new EdgeRedeemer(new Uint8Array(16).fill(0xbb))],
    )
    const originalBytes = encode((w) => writeEdgeWitnessSet(w, original))
    const redeemerHex = Bytes.toHex(encode((w) => writeEdgeRedeemer(w, original.redeemers[0])))

    const decoded = readEdgeWitnessSet(originalBytes)

    const newVkeys = [...decoded.vkeys, new EdgeVKey(new Uint8Array(32).fill(0xcc))]
    propagateHint(decoded.vkeys, newVkeys)
    const modified = new EdgeWitnessSet(newVkeys, decoded.redeemers)

    const reEncoded = encode((w) => writeEdgeWitnessSet(w, modified))

    const reParsed = readEdgeWitnessSet(reEncoded)
    const reRedeemerHex = Bytes.toHex(encode((w) => writeEdgeRedeemer(w, reParsed.redeemers[0])))

    expect(reRedeemerHex).toBe(redeemerHex)
  })

  it("redeemer array reference preserved -> raw bytes emitted", () => {
    const original = new EdgeWitnessSet(
      [new EdgeVKey(new Uint8Array(32).fill(0xaa))],
      [new EdgeRedeemer(new Uint8Array(16).fill(0xbb))],
    )
    const originalBytes = encode((w) => writeEdgeWitnessSet(w, original))
    const decoded = readEdgeWitnessSet(originalBytes)

    const modified = new EdgeWitnessSet(
      [...decoded.vkeys, new EdgeVKey(new Uint8Array(32).fill(0xdd))],
      decoded.redeemers,
    )

    const reEncoded = encode((w) => writeEdgeWitnessSet(w, modified))

    const reParsed = readEdgeWitnessSet(reEncoded)
    expect(reParsed.redeemers[0].data).toEqual(new Uint8Array(16).fill(0xbb))
  })
})

// ============================================================================
// CborWriter preserve edge: map key removal
// ============================================================================

describe("CborWriter preserve edge: map key removal", () => {
  it("removed key is skipped, surviving keys keep order", () => {
    const w = new CborWriter()
    const sourceMap = {}
    capture(sourceMap, undefined, { indefinite: false, keyOrder: [5n, 0n, 3n] })

    const entries = [
      { key: 5n, writeKey: () => w.writeUint(5n), writeValue: () => w.writeUint(50n) },
      { key: 0n, writeKey: () => w.writeUint(0n), writeValue: () => w.writeUint(10n) },
      { key: 3n, writeKey: () => w.writeUint(3n), writeValue: () => w.writeUint(30n) },
    ]

    const reducedEntries = entries.filter((e) => e.key !== 3n)
    w.writeMap(reducedEntries, sourceMap)
    const reducedBytes = w.finish()

    const r = new CborReader(reducedBytes)
    const count = r.readMapHeader()
    expect(count).toBe(2)
    expect(r.readUint()).toBe(5n)
    r.skip()
    expect(r.readUint()).toBe(0n)
  })

  it("added key appended after original order", () => {
    const sourceMap = {}
    capture(sourceMap, undefined, { indefinite: false, keyOrder: [5n, 0n] })

    const w = new CborWriter()
    const entries = [
      { key: 5n, writeKey: () => w.writeUint(5n), writeValue: () => w.writeUint(50n) },
      { key: 0n, writeKey: () => w.writeUint(0n), writeValue: () => w.writeUint(10n) },
      { key: 7n, writeKey: () => w.writeUint(7n), writeValue: () => w.writeUint(70n) },
    ]

    w.writeMap(entries, sourceMap)
    const bytes = w.finish()

    const r = new CborReader(bytes)
    const count = r.readMapHeader()
    expect(count).toBe(3)
    expect(r.readUint()).toBe(5n)
    r.skip()
    expect(r.readUint()).toBe(0n)
    r.skip()
    expect(r.readUint()).toBe(7n)
  })
})

// ============================================================================
// CborWriter preserve edge: subarray view lifetime
// ============================================================================

describe("CborWriter preserve edge: subarray view lifetime", () => {
  it("raw bytes are stale if input buffer is mutated", () => {
    const mutableBuf = new Uint8Array([0x82, 0x41, 0xab, 0x01])

    const r = new CborReader(mutableBuf)
    r.readArrayHeader()
    const start = r.position()
    const bytesVal = r.readBytes()
    const obj = { data: bytesVal }
    capture(obj, r.buffer().subarray(start, r.position()))

    mutableBuf[2] = 0xff

    const bytes = encode((w) => w.writePreserved(obj, () => { w.writeBytes(obj.data) }))

    const r2 = new CborReader(bytes)
    const result = r2.readBytes()
    expect(result[0]).toBe(0xff)
  })

  it("safe: use slice instead of subarray for untrusted inputs", () => {
    const mutableBuf = new Uint8Array([0x82, 0x41, 0xab, 0x01])

    const safeBuf = mutableBuf.slice()
    const r = new CborReader(safeBuf)
    r.readArrayHeader()
    const start = r.position()
    const bytesVal = r.readBytes()
    const obj = { data: bytesVal }
    capture(obj, r.buffer().subarray(start, r.position()))

    mutableBuf[2] = 0xff

    const bytes = encode((w) => w.writePreserved(obj, () => { w.writeBytes(obj.data) }))
    const r2 = new CborReader(bytes)
    expect(r2.readBytes()[0]).toBe(0xab)
  })
})

// ============================================================================
// Format-preserving writers
// ============================================================================

describe("writeUintPreserving", () => {
  it("no format → minimal encoding", () => {
    const bytes = encode((w) => w.writeUintPreserving(0n, undefined))
    expect(bytes).toEqual(new Uint8Array([0x00]))
  })

  it("width 0 → inline", () => {
    const bytes = encode((w) => w.writeUintPreserving(5n, 0))
    expect(bytes).toEqual(new Uint8Array([0x05]))
  })

  it("width 1 → non-minimal 0x18 prefix", () => {
    const bytes = encode((w) => w.writeUintPreserving(0n, 1))
    expect(bytes).toEqual(new Uint8Array([0x18, 0x00]))
  })

  it("width 2 → 3-byte encoding", () => {
    const bytes = encode((w) => w.writeUintPreserving(42n, 2))
    expect(bytes).toEqual(new Uint8Array([0x19, 0x00, 0x2a]))
  })

  it("width 4 → 5-byte encoding", () => {
    const bytes = encode((w) => w.writeUintPreserving(1n, 4))
    expect(bytes).toEqual(new Uint8Array([0x1a, 0x00, 0x00, 0x00, 0x01]))
  })

  it("width 8 → 9-byte encoding", () => {
    const bytes = encode((w) => w.writeUintPreserving(7n, 8))
    expect(bytes).toEqual(new Uint8Array([0x1b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07]))
  })

  it("upgrades width if value doesnt fit", () => {
    const bytes = encode((w) => w.writeUintPreserving(70000n, 2))
    expect(bytes[0]).toBe(0x1a)
  })

  it("width 0 upgrades if value >= 24", () => {
    const bytes = encode((w) => w.writeUintPreserving(42n, 0))
    expect(bytes).toEqual(new Uint8Array([0x18, 0x2a]))
  })

  it("width 1 upgrades if value >= 256", () => {
    const bytes = encode((w) => w.writeUintPreserving(300n, 1))
    expect(bytes).toEqual(new Uint8Array([0x19, 0x01, 0x2c]))
  })
})

describe("writeNintPreserving", () => {
  it("no format → minimal", () => {
    const bytes = encode((w) => w.writeNintPreserving(-1n, undefined))
    expect(bytes).toEqual(new Uint8Array([0x20]))
  })

  it("width 1 → non-minimal", () => {
    const bytes = encode((w) => w.writeNintPreserving(-1n, 1))
    expect(bytes).toEqual(new Uint8Array([0x38, 0x00]))
  })

  it("width 2 → 3-byte encoding", () => {
    const bytes = encode((w) => w.writeNintPreserving(-100n, 2))
    expect(bytes).toEqual(new Uint8Array([0x39, 0x00, 0x63]))
  })

  it("width 0 upgrades if pv >= 24", () => {
    const bytes = encode((w) => w.writeNintPreserving(-25n, 0))
    expect(bytes).toEqual(new Uint8Array([0x38, 0x18]))
  })
})

describe("writeHeaderPreserving", () => {
  it("no format → minimal array header", () => {
    const bytes = encode((w) => w.writeHeaderPreserving(4, 2, undefined))
    expect(bytes).toEqual(new Uint8Array([0x82]))
  })

  it("width 1 → non-minimal array header", () => {
    const bytes = encode((w) => w.writeHeaderPreserving(4, 2, 1))
    expect(bytes).toEqual(new Uint8Array([0x98, 0x02]))
  })

  it("width 2 → 3-byte map header", () => {
    const bytes = encode((w) => w.writeHeaderPreserving(5, 3, 2))
    expect(bytes).toEqual(new Uint8Array([0xb9, 0x00, 0x03]))
  })

  it("width 4 → 5-byte tag header", () => {
    const bytes = encode((w) => w.writeHeaderPreserving(6, 258, 4))
    expect(bytes).toEqual(new Uint8Array([0xda, 0x00, 0x00, 0x01, 0x02]))
  })
})

describe("writeBytesPreserving", () => {
  it("no format → definite encoding", () => {
    const bytes = encode((w) => w.writeBytesPreserving(new Uint8Array([0x01, 0x02, 0x03])))
    expect(bytes).toEqual(new Uint8Array([0x43, 0x01, 0x02, 0x03]))
  })

  it("indefinite with chunks", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03])
    const bytes = encode((w) => w.writeBytesPreserving(data, { indefinite: true, chunks: [2, 1] }))
    expect(bytes).toEqual(new Uint8Array([0x5f, 0x42, 0x01, 0x02, 0x41, 0x03, 0xff]))
  })

  it("indefinite without chunks → single chunk", () => {
    const data = new Uint8Array([0xaa, 0xbb])
    const bytes = encode((w) => w.writeBytesPreserving(data, { indefinite: true }))
    expect(bytes).toEqual(new Uint8Array([0x5f, 0x42, 0xaa, 0xbb, 0xff]))
  })

  it("roundtrip: indefinite byte string decode → preserve → re-encode", () => {
    const original = new Uint8Array([0x5f, 0x42, 0x01, 0x02, 0x41, 0x03, 0xff])
    const r = new CborReader(original)
    const [data, fmt] = r.readBytesAnnotated()

    const reEncoded = encode((w) => w.writeBytesPreserving(data, fmt))
    expect(reEncoded).toEqual(original)
  })
})

// ============================================================================
// FormatHint: capture + getFormat
// ============================================================================

describe("FormatHint: capture and retrieve", () => {
  it("capture stores full hint", () => {
    const obj = { fee: 42n }
    capture(obj, undefined, {
      indefinite: false,
      headerWidth: 1,
      fields: new Map([["fee", { byteSize: 2 as const }]]),
    })

    const fmt = getFormat(obj)
    expect(fmt?.indefinite).toBe(false)
    expect(fmt?.headerWidth).toBe(1)
    expect(fmt?.fields?.get("fee")?.byteSize).toBe(2)
  })

  it("getFieldFormat shortcut", () => {
    const obj = {}
    capture(obj, undefined, {
      indefinite: false,
      fields: new Map([[0n, { byteSize: 2 as const }]]),
    })

    expect(getFieldFormat(obj, 0n)?.byteSize).toBe(2)
    expect(getFieldFormat(obj, 1n)).toBeUndefined()
  })

  it("propagateHint copies hint without raw", () => {
    const src = {}
    capture(src, new Uint8Array([0x01]), {
      indefinite: true,
      headerWidth: 2,
      keyOrder: [0n, 2n],
      fields: new Map<string | number | bigint, FieldFormat>([
        [0n, { byteSize: 0 as const }],
        ["fee", { byteSize: 2 as const }],
      ]),
    })

    const dst = {}
    propagateHint(src, dst)

    const preserved = getPreserved(dst)
    expect(preserved?.raw).toBeUndefined() // raw not propagated
    expect(preserved?.hint?.indefinite).toBe(true)
    expect(preserved?.hint?.headerWidth).toBe(2)
    expect(preserved?.hint?.fields?.get("fee")?.byteSize).toBe(2)
    expect(preserved?.hint?.keyOrder).toEqual([0n, 2n])
  })
})

// ============================================================================
// FormatHint: end-to-end — rebuild object with preserved field formats
// ============================================================================

describe("FormatHint: end-to-end format preservation on rebuild", () => {
  it("non-minimal fee preserved when body rebuilt", () => {
    const nonCanonicalBody = new Uint8Array([
      0xa2,             // map(2)
      0x00,             // key 0
      0x80,             // array(0) — empty inputs
      0x02,             // key 2
      0x18, 0x00,       // uint(0) — NON-CANONICAL
    ])

    // Decode with annotated methods — no span tracking needed
    const r = new CborReader(nonCanonicalBody)
    const [mapCount, mapFmt] = r.readMapHeaderAnnotated()

    const fields = new Map<string | number | bigint, FieldFormat>()

    for (let i = 0; i < mapCount; i++) {
      const [key, keyWidth] = r.readUintAnnotated()
      fields.set(Number(key), { byteSize: keyWidth })

      if (key === 0n) {
        r.readArrayHeader() // skip inputs
      } else if (key === 2n) {
        const [, feeWidth] = r.readUintAnnotated()
        fields.set("fee", { byteSize: feeWidth })
      }
    }

    const body = { inputs: [] as Array<unknown>, fee: 0n }
    capture(body, undefined, {
      indefinite: mapFmt.indefinite,
      headerWidth: mapFmt.headerWidth,
      keyOrder: [0n, 2n],
      fields,
    })

    // Rebuild body with new fee — format preserved
    const newBody = { inputs: [], fee: 5n }
    propagateHint(body, newBody)

    const reEncoded = encode((w) => {
      const fmt = getFormat(newBody)
      w.writeHeaderPreserving(5, 2, fmt?.headerWidth)
      w.writeUintPreserving(0n, getFieldFormat(newBody, 0)?.byteSize)
      w.writeDefiniteArrayHeader(0)
      w.writeUintPreserving(2n, getFieldFormat(newBody, 2)?.byteSize)
      w.writeUintPreserving(newBody.fee, getFieldFormat(newBody, "fee")?.byteSize)
    })

    const r2 = new CborReader(reEncoded)
    r2.readMapHeader()
    r2.readUint() // key 0
    r2.readArrayHeader() // inputs
    r2.readUint() // key 2
    const feePos = r2.position()
    r2.readUint()
    expect(reEncoded[feePos]).toBe(0x18) // non-minimal 1-byte width preserved
    expect(reEncoded[feePos + 1]).toBe(0x05) // value 5
  })

  it("container header width preserved on rebuild", () => {
    const bytes = encode((w) => {
      w.writeHeaderPreserving(4, 2, 1)
      w.writeUint(10n)
      w.writeUint(20n)
    })

    expect(bytes[0]).toBe(0x98)
    expect(bytes[1]).toBe(0x02)

    // Decode with annotated method
    const r = new CborReader(bytes)
    const [, arrFmt] = r.readArrayHeaderAnnotated()

    const arr = [10n, 20n, 30n]
    capture(arr, undefined, {
      indefinite: arrFmt.indefinite,
      headerWidth: arrFmt.headerWidth,
    })

    const reEncoded = encode((w) => {
      const fmt = getFormat(arr)
      w.writeHeaderPreserving(4, 3, fmt?.headerWidth)
      for (const v of arr) w.writeUint(v)
    })

    expect(reEncoded[0]).toBe(0x98)
    expect(reEncoded[1]).toBe(0x03)
  })

  it("tag header width preserved on rebuild", () => {
    const original = encode((w) => {
      w.writeHeaderPreserving(6, 258, 4)
      w.writeDefiniteArrayHeader(0)
    })

    expect(original[0]).toBe(0xda)

    const reEncoded = encode((w) => {
      w.writeHeaderPreserving(6, 258, 4)
      w.writeDefiniteArrayHeader(1)
      w.writeUint(99n)
    })

    expect(reEncoded[0]).toBe(0xda)
    expect(reEncoded[1]).toBe(0x00)
    expect(reEncoded[2]).toBe(0x00)
    expect(reEncoded[3]).toBe(0x01)
    expect(reEncoded[4]).toBe(0x02)
  })
})

// ============================================================================
// writeTextPreserving
// ============================================================================

describe("writeTextPreserving", () => {
  it("no format → definite encoding", () => {
    const bytes = encode((w) => w.writeTextPreserving("hi"))
    expect(bytes).toEqual(new Uint8Array([0x62, 0x68, 0x69]))
  })

  it("indefinite with chunks", () => {
    const bytes = encode((w) => w.writeTextPreserving("abc", { indefinite: true, chunks: [1, 2] }))
    expect(bytes).toEqual(new Uint8Array([0x7f, 0x61, 0x61, 0x62, 0x62, 0x63, 0xff]))
  })

  it("roundtrip: indefinite text decode → preserve → re-encode", () => {
    const original = new Uint8Array([0x7f, 0x61, 0x61, 0x62, 0x62, 0x63, 0xff])
    const r = new CborReader(original)
    const [text, fmt] = r.readTextAnnotated()
    expect(text).toBe("abc")

    const reEncoded = encode((w) => w.writeTextPreserving(text, fmt))
    expect(reEncoded).toEqual(original)
  })
})

// ============================================================================
// readTagHeaderOrNull
// ============================================================================

describe("readTagHeaderOrNull", () => {
  it("reads tag when present", () => {
    const bytes = new Uint8Array([0xd9, 0x01, 0x02, 0x80])
    const r = new CborReader(bytes)
    const tag = r.readTagHeaderOrNull(258)
    expect(tag).toBe(258)
    expect(r.readArrayHeader()).toBe(0)
  })

  it("returns null when no tag", () => {
    const bytes = new Uint8Array([0x80])
    const r = new CborReader(bytes)
    const tag = r.readTagHeaderOrNull(258)
    expect(tag).toBeNull()
    expect(r.readArrayHeader()).toBe(0)
  })

  it("throws on wrong tag number", () => {
    const bytes = new Uint8Array([0xd8, 0x79, 0x00])
    const r = new CborReader(bytes)
    expect(() => r.readTagHeaderOrNull(258)).toThrow("Expected tag 258, got 121")
  })
})

// ============================================================================
// CborWriter: finish vs finishView
// ============================================================================

describe("CborWriter: finish vs finishView", () => {
  it("finishView returns view without copy", () => {
    const w = new CborWriter()
    w.writeUint(42n)
    const view = w.finishView()
    const copy = w.finish()
    expect(view).toEqual(copy)
    expect(view.buffer).not.toBe(copy.buffer)
  })
})

// ============================================================================
// capture with raw bytes
// ============================================================================

describe("capture with raw bytes", () => {
  it("preserves raw bytes from explicit capture", () => {
    const rawBytes = new Uint8Array([0x82, 0x01, 0x02])
    const obj = { data: "test" }
    capture(obj, rawBytes)

    const bytes = encode((w) => w.writePreserved(obj, () => { w.writeUint(99n) }))
    expect(bytes).toEqual(rawBytes)
  })

  it("works with class-based reader", () => {
    const data = new Uint8Array([0x82, 0x01, 0x02])
    const reader = new CborReader(data)
    const start = reader.position()
    reader.readArrayHeader()
    reader.readUint()
    reader.readUint()
    const rawSlice = data.subarray(start, reader.position())

    const obj = {}
    capture(obj, rawSlice)

    const bytes = encode((w) => w.writePreserved(obj, () => { w.writeUint(0n) }))
    expect(bytes).toEqual(data)
  })
})

// ============================================================================
// writeMap with format-aware keys
// ============================================================================

describe("writeMap with format-aware keys", () => {
  it("passes field format to key writers", () => {
    const sourceMap = {}
    capture(sourceMap, undefined, {
      indefinite: false,
      keyOrder: [0n, 2n],
      fields: new Map([
        [0n, { byteSize: 1 as const }],
        [2n, { byteSize: 0 as const }],
      ]),
    })

    const w = new CborWriter()
    const entries = [
      { key: 0n, writeKey: (fmt?: FieldFormat) => w.writeUintPreserving(0n, fmt?.byteSize), writeValue: () => w.writeUint(10n) },
      { key: 2n, writeKey: (fmt?: FieldFormat) => w.writeUintPreserving(2n, fmt?.byteSize), writeValue: () => w.writeUint(20n) },
    ]

    w.writeMap(entries, sourceMap)
    const bytes = w.finish()

    const r = new CborReader(bytes)
    r.readMapHeader()
    expect(bytes[1]).toBe(0x18)
    expect(bytes[2]).toBe(0x00)
    r.readUint()
    r.readUint()
    const key2Pos = r.position()
    expect(bytes[key2Pos]).toBe(0x02)
  })
})

// ============================================================================
// CborReader: readSmallUint
// ============================================================================

describe("CborReader: readSmallUint", () => {
  it("inline value (< 24)", () => {
    const r = new CborReader(new Uint8Array([0x17]))
    expect(r.readSmallUint()).toBe(23)
  })

  it("1-byte value", () => {
    const r = new CborReader(new Uint8Array([0x18, 0xff]))
    expect(r.readSmallUint()).toBe(255)
  })

  it("2-byte value", () => {
    const r = new CborReader(new Uint8Array([0x19, 0x01, 0x00]))
    expect(r.readSmallUint()).toBe(256)
  })

  it("4-byte value", () => {
    const r = new CborReader(new Uint8Array([0x1a, 0x00, 0x01, 0x00, 0x00]))
    expect(r.readSmallUint()).toBe(65536)
  })

  it("throws on 8-byte value", () => {
    const r = new CborReader(new Uint8Array([0x1b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]))
    expect(() => r.readSmallUint()).toThrow()
  })
})

// ============================================================================
// CborReader: reset
// ============================================================================

describe("CborReader: reset", () => {
  it("reads new data after reset", () => {
    const r = new CborReader(new Uint8Array([0x01]))
    expect(r.readUint()).toBe(1n)

    r.reset(new Uint8Array([0x05]))
    expect(r.readUint()).toBe(5n)
  })

  it("cursor resets to 0", () => {
    const r = new CborReader(new Uint8Array([0x01, 0x02]))
    r.readUint()
    expect(r.position()).toBe(1)

    r.reset(new Uint8Array([0x03]))
    expect(r.position()).toBe(0)
  })
})

// ============================================================================
// CborReader: readNint
// ============================================================================

describe("CborReader: readNint", () => {
  it("inline (-1)", () => {
    const r = new CborReader(new Uint8Array([0x20]))
    expect(r.readNint()).toBe(-1n)
  })

  it("inline (-24)", () => {
    const r = new CborReader(new Uint8Array([0x37]))
    expect(r.readNint()).toBe(-24n)
  })

  it("1-byte (-100)", () => {
    const r = new CborReader(new Uint8Array([0x38, 0x63]))
    expect(r.readNint()).toBe(-100n)
  })

  it("2-byte (-1000)", () => {
    const r = new CborReader(new Uint8Array([0x39, 0x03, 0xe7]))
    expect(r.readNint()).toBe(-1000n)
  })
})

// ============================================================================
// CborReader: large 8-byte uint
// ============================================================================

describe("CborReader: large uint", () => {
  it("reads 8-byte uint", () => {
    // 2^32 = 4294967296
    const r = new CborReader(new Uint8Array([0x1b, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]))
    expect(r.readUint()).toBe(4294967296n)
  })

  it("reads max safe uint64", () => {
    // 2^64 - 1 = 18446744073709551615
    const r = new CborReader(new Uint8Array([0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
    expect(r.readUint()).toBe(18446744073709551615n)
  })
})

// ============================================================================
// CborReader: readTextAnnotated definite
// ============================================================================

describe("CborReader: readTextAnnotated definite", () => {
  it("returns text with definite format", () => {
    const r = new CborReader(new Uint8Array([0x62, 0x68, 0x69]))
    const [text, fmt] = r.readTextAnnotated()
    expect(text).toBe("hi")
    expect(fmt.indefinite).toBe(false)
    expect(fmt.chunks).toBeUndefined()
  })
})

// ============================================================================
// CborReader: readBool, readNull, isComplete, peekMajorType
// ============================================================================

describe("CborReader: simple values and navigation", () => {
  it("readBool true", () => {
    const r = new CborReader(new Uint8Array([0xf5]))
    expect(r.readBool()).toBe(true)
  })

  it("readBool false", () => {
    const r = new CborReader(new Uint8Array([0xf4]))
    expect(r.readBool()).toBe(false)
  })

  it("readBool throws on non-bool", () => {
    const r = new CborReader(new Uint8Array([0x01]))
    expect(() => r.readBool()).toThrow()
  })

  it("readNull", () => {
    const r = new CborReader(new Uint8Array([0xf6]))
    expect(r.readNull()).toBeNull()
  })

  it("readNull throws on non-null", () => {
    const r = new CborReader(new Uint8Array([0x01]))
    expect(() => r.readNull()).toThrow()
  })

  it("isComplete", () => {
    const r = new CborReader(new Uint8Array([0x01]))
    expect(r.isComplete()).toBe(false)
    r.readUint()
    expect(r.isComplete()).toBe(true)
  })

  it("peekMajorType", () => {
    const r = new CborReader(new Uint8Array([0x42, 0x01, 0x02]))
    expect(r.peekMajorType()).toBe(2) // bytes
    expect(r.position()).toBe(0) // didn't advance
  })
})

// ============================================================================
// CborReader: truncated input
// ============================================================================

describe("CborReader: truncated input", () => {
  it("throws on empty buffer", () => {
    const r = new CborReader(new Uint8Array([]))
    expect(() => r.readUint()).toThrow("Unexpected end of CBOR input")
  })

  it("throws on truncated 2-byte uint", () => {
    // 0x19 says "2-byte uint follows" but only 1 byte available
    const r = new CborReader(new Uint8Array([0x19, 0x01]))
    expect(() => r.readUint()).toThrow("Unexpected end of CBOR input")
  })

  it("throws on truncated byte string", () => {
    // 0x43 says "3-byte string" but only 2 bytes available
    const r = new CborReader(new Uint8Array([0x43, 0xaa, 0xbb]))
    expect(() => r.readBytes()).toThrow("Unexpected end of CBOR input")
  })

  it("throws on truncated text string", () => {
    const r = new CborReader(new Uint8Array([0x62, 0x68]))
    expect(() => r.readText()).toThrow("Unexpected end of CBOR input")
  })

  it("throws on truncated indefinite without break", () => {
    // indefinite array with element but no 0xff break
    const r = new CborReader(new Uint8Array([0x9f, 0x01]))
    r.readArrayHeader() // -1
    r.readUint() // 1n
    expect(() => r.isBreak()).toThrow("Unexpected end of CBOR input")
  })

  it("throws on peek past end", () => {
    const r = new CborReader(new Uint8Array([0x01]))
    r.readUint()
    expect(() => r.peekByte()).toThrow("Unexpected end of CBOR input")
  })
})

// ============================================================================
// CborReader: readIntAnnotated
// ============================================================================

describe("CborReader: readIntAnnotated", () => {
  it("positive inline", () => {
    const r = new CborReader(new Uint8Array([0x05]))
    const [value, width] = r.readIntAnnotated()
    expect(value).toBe(5n)
    expect(width).toBe(0)
  })

  it("positive 1-byte", () => {
    const r = new CborReader(new Uint8Array([0x18, 0x2a]))
    const [value, width] = r.readIntAnnotated()
    expect(value).toBe(42n)
    expect(width).toBe(1)
  })

  it("negative inline", () => {
    const r = new CborReader(new Uint8Array([0x20]))
    const [value, width] = r.readIntAnnotated()
    expect(value).toBe(-1n)
    expect(width).toBe(0)
  })

  it("negative 1-byte", () => {
    const r = new CborReader(new Uint8Array([0x38, 0x63]))
    const [value, width] = r.readIntAnnotated()
    expect(value).toBe(-100n)
    expect(width).toBe(1)
  })

  it("throws on non-integer", () => {
    const r = new CborReader(new Uint8Array([0x42, 0x01, 0x02]))
    expect(() => r.readIntAnnotated()).toThrow("Expected integer")
  })
})

// ============================================================================
// Test helpers — reusable patterns for domain module tests
// ============================================================================

describe("Test helper patterns", () => {
  /**
   * Reusable roundtrip test: encode → decode → re-encode = same bytes.
   * Use this pattern in every domain module test.
   */
  const roundtrip = <T>(
    write: (w: CborWriter, v: T) => void,
    read: (r: CborReader) => T,
    value: T,
  ): { bytes: Uint8Array; decoded: T; reEncoded: Uint8Array } => {
    const w = new CborWriter()
    write(w, value)
    const bytes = w.finishView()
    const decoded = read(new CborReader(bytes))
    const w2 = new CborWriter()
    write(w2, decoded)
    const reEncoded = w2.finishView()
    return { bytes, decoded, reEncoded }
  }

  /**
   * Reusable CML byte parity test.
   * Compares our encode output with CML's to_cbor_bytes.
   */
  const cmlParity = (ours: Uint8Array, cml: Uint8Array): boolean => {
    if (ours.length !== cml.length) return false
    for (let i = 0; i < ours.length; i++) { if (ours[i] !== cml[i]) return false }
    return true
  }

  it("roundtrip helper — simple uint", () => {
    const { bytes, decoded, reEncoded } = roundtrip<bigint>(
      (w, v) => w.writeUint(v),
      (r) => r.readUint(),
      42n,
    )
    expect(decoded).toBe(42n)
    expect(reEncoded).toEqual(bytes)
  })

  it("roundtrip helper — array of bytes", () => {
    const hash = new Uint8Array(32).fill(0xab)
    const { bytes, decoded, reEncoded } = roundtrip<Uint8Array>(
      (w, v) => w.writeBytes(v),
      (r) => r.readBytes(),
      hash,
    )
    expect(decoded).toEqual(hash)
    expect(reEncoded).toEqual(bytes)
  })

  it("cmlParity helper", () => {
    expect(cmlParity(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(cmlParity(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(cmlParity(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false)
  })

  it("format preservation helper — non-minimal uint survives roundtrip", () => {
    // Encode 0 as non-minimal 0x18 0x00
    const w = new CborWriter()
    w.writeUintPreserving(0n, 1)
    const original = w.finishView()
    expect(original).toEqual(new Uint8Array([0x18, 0x00]))

    // Decode with annotated, capture format
    const r = new CborReader(original)
    const [value, width] = r.readUintAnnotated()
    expect(value).toBe(0n)
    expect(width).toBe(1)

    // Re-encode with preserved width
    const w2 = new CborWriter()
    w2.writeUintPreserving(value, width)
    expect(w2.finishView()).toEqual(original)
  })
})
