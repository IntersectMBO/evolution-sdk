/**
 * Reading an ASSEMBLED transaction back with CML — shared by the builder gates.
 *
 * ⚠️ Not a convenience. Every CIP-113 builder puts INDICES in redeemers, and an index is only
 * meaningful against the finished transaction: the reference inputs sorted by outpoint, the
 * withdrawals as the script context orders them, the inputs canonically. Each builder's test
 * therefore resolves its indices against the parsed result, and this is the one parser they
 * share so the two cannot disagree about what "the finished transaction" is.
 */
import { createRequire } from "node:module"

import type { Plan } from "@evolution-sdk/plan"

const require = createRequire(import.meta.url)
/** The oracle is an untyped WASM binding, so its objects are shaped only by what we call. */
type Oracle = any
export const CML: Oracle = require("@dcspark/cardano-multiplatform-lib-nodejs")

/** CBOR map header for 0-23 entries, which is every witness set these builders emit. */
const mapHeader = (n: number): string => (0xa0 + n).toString(16).padStart(2, "0")

/**
 * Reassemble body + witness set into a whole Conway transaction and hand it to CML.
 *
 * ⚠️ Parsing the two halves separately would not catch a witness set the ledger cannot read
 * beside this body. A full parse is also the cheapest statement that what we assembled IS a
 * transaction to an implementation nobody here wrote.
 */
export const parseTx = (built: Plan.UnsignedPlanTx): Oracle => {
  const entries = built.witnessExtra.map(([k, hex]) => `${k.toString(16).padStart(2, "0")}${hex}`)
  const witnessSetHex = `${mapHeader(entries.length)}${entries.join("")}`
  const aux = built.auxHex === "" ? "f6" : built.auxHex
  return CML.Transaction.from_cbor_hex(`84${built.bodyHex}${witnessSetHex}f5${aux}`)
}

export interface AssembledOutput {
  readonly addressHex: string
  readonly datumHex?: string
  readonly hasDatumHash: boolean
  readonly hasScriptRef: boolean
  readonly assetIds: ReadonlyArray<string>
}

export interface Assembled {
  readonly outpoints: ReadonlyArray<string>
  readonly referenceInputs: ReadonlyArray<string>
  readonly collateral: ReadonlyArray<string>
  readonly withdrawalAccounts: ReadonlyArray<string>
  readonly requiredSigners: ReadonlyArray<string>
  readonly mint: ReadonlyArray<{ readonly policyHex: string; readonly nameHex: string; readonly amount: bigint }>
  readonly outputs: ReadonlyArray<AssembledOutput>
  readonly redeemers: ReadonlyArray<{ readonly tag: number; readonly index: bigint; readonly dataHex: string }>
  readonly scriptsV3: number
}

const outpoint = (i: Oracle): string => `${i.transaction_id().to_hex()}#${i.index()}`

export const assembled = (built: Plan.UnsignedPlanTx): Assembled => {
  const tx = parseTx(built)
  const body = tx.body()
  const witnesses = tx.witness_set()
  const list = (xs: Oracle, f: (x: Oracle) => string): ReadonlyArray<string> =>
    xs === undefined ? [] : Array.from({ length: xs.len() }, (_, i) => f(xs.get(i)))
  const w = body.withdrawals()
  const redeemers = witnesses.redeemers()
  if (redeemers === undefined) throw new Error("the witness set carries no redeemers")
  const map = redeemers.as_map_redeemer_key_to_redeemer_val()
  const keys = map.keys()
  const scripts = witnesses.plutus_v3_scripts()
  const mint = body.mint()
  const mintRows: Array<{ policyHex: string; nameHex: string; amount: bigint }> = []
  if (mint !== undefined) {
    const policies = mint.keys()
    for (let i = 0; i < policies.len(); i += 1) {
      const policy = policies.get(i)
      const assets = mint.get_assets(policy)
      const names = assets.keys()
      for (let j = 0; j < names.len(); j += 1) {
        const name = names.get(j)
        mintRows.push({ policyHex: policy.to_hex(), nameHex: name.to_hex(), amount: assets.get(name) })
      }
    }
  }
  return {
    outpoints: list(body.inputs(), outpoint),
    referenceInputs: list(body.reference_inputs(), outpoint),
    collateral: list(body.collateral_inputs(), outpoint),
    // CML returns the map in the order the body serialises it, which is canonical CBOR.
    withdrawalAccounts: w === undefined ? [] : list(w.keys(), (k) => k.to_address().to_hex()),
    requiredSigners: list(body.required_signers(), (s) => s.to_hex()),
    mint: mintRows,
    outputs: Array.from({ length: body.outputs().len() }, (_, i) => {
      const o = body.outputs().get(i)
      // ⚠️ Through the datum OPTION, not `o.datum()`: an inline datum is wrapped in CBOR tag 24
      // on the wire, so the convenience accessor hands back the wrapper and parsing it as plutus
      // data fails on the tag. `as_datum()` is the unwrapped plutus_data the validator sees.
      const conway = o.as_conway_format_tx_out()
      const option = conway === undefined ? undefined : conway.datum_option()
      const datum = option === undefined ? undefined : option.as_datum()
      const amount = o.amount().multi_asset()
      const ids: Array<string> = []
      const policies = amount.keys()
      for (let p = 0; p < policies.len(); p += 1) {
        const policy = policies.get(p)
        const names = amount.get_assets(policy)!.keys()
        for (let n = 0; n < names.len(); n += 1) ids.push(`${policy.to_hex()}.${names.get(n).to_hex()}`)
      }
      return {
        addressHex: o.address().to_hex(),
        ...(datum === undefined ? {} : { datumHex: datum.to_cbor_hex() }),
        hasDatumHash: option !== undefined && option.as_hash() !== undefined,
        hasScriptRef: o.script_ref() !== undefined,
        assetIds: ids,
      }
    }),
    redeemers: Array.from({ length: keys.len() }, (_, i) => {
      const k = keys.get(i)
      return { tag: Number(k.tag()), index: k.index(), dataHex: map.get(k).data().to_cbor_hex() }
    }),
    scriptsV3: scripts === undefined ? 0 : scripts.len(),
  }
}

/** The integer fields of a redeemer, read back out of the assembled bytes. */
export const intsOf = (dataHex: string): ReadonlyArray<string> => {
  const f = CML.PlutusData.from_cbor_hex(dataHex).as_constr_plutus_data().fields()
  return Array.from({ length: f.len() }, (_, i) => f.get(i))
    .filter((d: Oracle) => d.kind() === 3)
    .map((d: Oracle) => d.as_integer().to_str())
}
