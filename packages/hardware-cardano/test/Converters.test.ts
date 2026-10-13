import { Inspect } from "@evolution-sdk/review"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { parseDerivationPath } from "../src/internal/Path.js"
import * as Ledger from "../src/Ledger.js"
import * as Trezor from "../src/Trezor.js"
import { CardanoDerivationType, CardanoTxSigningMode } from "../src/TrezorTypes.js"

const IN32 = "11".repeat(32)
const FEE = "021a000f4240"
// `a3` is three pairs: 0 inputs, 1 outputs, 2 fee. Written by hand so the expectations below do
// not come from the decoder they are checking.
const BARE = `a30081825820${IN32}000180${FEE}`
const TAGGED = `a300d9010281825820${IN32}000180${FEE}`

const PAYMENT_PATH = "m/1852'/1815'/0'/0/0"
const STAKE_PATH = "m/1852'/1815'/0'/2/0"
const PATHS = [PAYMENT_PATH, STAKE_PATH]

const parse = (hex: string): { body: Inspect.TxBodyView; taggedSets: boolean } => Effect.runSync(Inspect.txBody(hex))

describe("a field the device cannot reproduce is a refusal, not a warning", () => {
  // ⚠️ The device recomputes the body hash from the request. A converter that dropped a field it
  // could not represent would hand back a signature over a different transaction than the one
  // the user approved, so both of these must throw.
  const unknownKeys = `a500d9010281825820${IN32}000180${FEE}06f61701`

  it("Ledger refuses a body carrying keys the view cannot name", () => {
    const { body } = parse(unknownKeys)
    expect(body.unknownKeys).toEqual([6, 23])
    expect(() => Ledger.buildLedgerSignRequest(body, 0, PATHS)).toThrow(/unsupported field keys/)
  })

  it("Trezor refuses the same body", () => {
    const { body } = parse(unknownKeys)
    expect(() => Trezor.buildTrezorSignRequest(body, 0, PATHS)).toThrow(/unsupported field keys/)
  })
})

describe("the set tag travels into the request", () => {
  // ⚠️ Whether the input set arrived `#6.258` or bare changes the bytes the device re-emits, and
  // therefore the body hash. It is carried, not inferred.
  it("Ledger sets tagCborSets only when the body was tagged", () => {
    const tagged = parse(TAGGED)
    const bare = parse(BARE)
    expect(tagged.taggedSets).toBe(true)
    expect(bare.taggedSets).toBe(false)
    const withTag = Ledger.buildLedgerSignRequest(tagged.body, 0, PATHS, "ordinary_transaction", {
      tagCborSets: tagged.taggedSets
    })
    const without = Ledger.buildLedgerSignRequest(bare.body, 0, PATHS, "ordinary_transaction", {
      tagCborSets: bare.taggedSets
    })
    expect(withTag.options).toEqual({ tagCborSets: true })
    expect(without.options).toBeUndefined()
  })
})

describe("the request a well-formed body produces", () => {
  it("Ledger carries the inputs, fee and network", () => {
    const { body } = parse(BARE)
    const req = Ledger.buildLedgerSignRequest(body, 0, PATHS)
    expect(req.signingMode).toBe("ordinary_transaction")
    expect(req.tx.fee).toBe("1000000")
    expect(req.tx.inputs).toHaveLength(1)
    expect(req.tx.inputs[0]!.txHashHex).toBe(IN32)
    // networkId 0 is a testnet, whose protocol magic is not mainnet's.
    expect(req.tx.network).toEqual({ networkId: 0, protocolMagic: 1 })
  })

  it("Trezor carries the same facts in its own shape, and asks for ICARUS_TREZOR derivation", () => {
    const { body } = parse(BARE)
    const req = Trezor.buildTrezorSignRequest(body, 0, PATHS)
    expect(req.signingMode).toBe(CardanoTxSigningMode.ORDINARY_TRANSACTION)
    expect(req.fee).toBe("1000000")
    expect(req.inputs[0]!.prev_hash).toBe(IN32)
    expect(req.derivationType).toBe(CardanoDerivationType.ICARUS_TREZOR)
  })

  it("mainnet gets the mainnet protocol magic", () => {
    const { body } = parse(BARE)
    expect(Ledger.buildLedgerSignRequest(body, 1, PATHS).tx.network.protocolMagic).toBe(764824073)
  })
})

describe("derivation paths", () => {
  it("parses hardened and unhardened components", () => {
    expect(parseDerivationPath(PAYMENT_PATH)).toEqual([0x80000000 + 1852, 0x80000000 + 1815, 0x80000000, 0, 0])
  })

  // ⚠️ A device is handed this array verbatim. `parseInt` would read "1e3" as 1 and "zz" as NaN,
  // so a typo becomes either an unusable path or -- worse -- a VALID path to a different key.
  for (const bad of ["m/1852'/1815'/0'/0/zz", "m/1852'/1815'/0'/0/1e3", "m/1852'/1815'/0'/0/", "m//0"]) {
    it(`refuses ${JSON.stringify(bad)} instead of deriving the wrong key`, () => {
      expect(() => parseDerivationPath(bad)).toThrow(/not an index/)
    })
  }
})
