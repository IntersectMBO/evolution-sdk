/**
 * The CIP-113 byte structures, against the CBOR rule they encode and against an oracle.
 *
 * ⚠️ Why this file exists: `Cip113.ts` is 1,062 lines of redeemer and datum codecs with on-chain
 * consequence and it had **no test of any kind**. Every byte here reaches a validator, and the
 * failure mode is not a crash: a wrong constructor index or a shifted field decodes cleanly and
 * fails in phase 2, after the fee is paid.
 *
 * Three kinds of evidence, because "byte-identical to CML" is the wrong demand for some of these
 * and a harness that demands it anyway reports its own mistakes as defects:
 *
 *   RULE   the expected hex is spelled out as a literal and re-derivable from the Plutus CDDL
 *          without running anything: `Constr n` is CBOR tag `121 + n` (`d879`, `d87a`, `d87b`)
 *          over an INDEFINITE array (`9f` … `ff`) when it has fields and a DEFINITE empty one
 *          (`80`) when it has none; a 28-byte string is `581c` + the bytes, a 30-byte one `581e`,
 *          the empty one `40`; a small uint is its own byte.
 *   READS  CML parses our bytes, returns them byte for byte, and reads the content we meant.
 *          This is the apt comparison for anything with fields: a Plutus list is indefinite-framed
 *          on chain and in our encoder, while CML's BUILDER defaults to definite, so comparing
 *          against its builder would measure its default.
 *   BYTES  ours === CML's own encoding. Available for the field-less constructors, where both
 *          tools emit the definite empty form, and for the addresses.
 *
 * The decoders are fed CML-BUILT bytes, never our own encoder's: a round trip through one
 * implementation agrees with itself by construction.
 */
import { createRequire } from "node:module"

import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import { Network } from "../src/Types.js"
import { LATEST, V0_0_1, V0_3_0, V0_4_0, V0_5_0_ALPHA_2, V0_5_0_ALPHA_4 } from "../src/Versions.js"

const require = createRequire(import.meta.url)
/** The oracle is an untyped WASM binding, so its objects are shaped only by what we call. */
type Oracle = any
const CML: Oracle = require("@dcspark/cardano-multiplatform-lib-nodejs")

const B = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"))
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex")
const h28 = (b: string): string => b.repeat(28)

const run = <A, E>(e: Effect.Effect<A, E>): A => Effect.runSync(e as Effect.Effect<A, never>)
const fail = <A, E>(e: Effect.Effect<A, E>): E => {
  const r = Effect.runSync(Effect.either(e))
  if (Either.isRight(r)) throw new Error(`expected a failure, got ${JSON.stringify(r.right)}`)
  return r.left
}

// ── CML plutus-data builders (the oracle side) ──────────────────────────────────

const cmlList = (items: ReadonlyArray<Oracle>): Oracle => {
  const l = CML.PlutusDataList.new()
  for (const i of items) l.add(i)
  return l
}
const cmlConstr = (alt: bigint, fields: ReadonlyArray<Oracle>): Oracle =>
  CML.PlutusData.new_constr_plutus_data(CML.ConstrPlutusData.new(alt, cmlList(fields)))
const cmlBytes = (h: string): Oracle => CML.PlutusData.new_bytes(B(h))
const cmlInt = (dec: string): Oracle => CML.PlutusData.new_integer(CML.BigInteger.from_str(dec))
const cmlCred = (kind: "key" | "script", hashHex: string): Oracle =>
  cmlConstr(kind === "script" ? 1n : 0n, [cmlBytes(hashHex)])

/** What CML makes of our bytes: the framing it returns, and the structure it reads. */
const parse = (h: string): Oracle => CML.PlutusData.from_cbor_hex(h)
const constrOf = (h: string): Oracle => parse(h).as_constr_plutus_data()
const fieldsOf = (h: string): ReadonlyArray<Oracle> => {
  const f = constrOf(h).fields()
  return Array.from({ length: f.len() }, (_, i) => f.get(i))
}
const bytesAt = (h: string, i: number): string => hex(fieldsOf(h)[i]!.as_bytes())
const intAt = (h: string, i: number): string => fieldsOf(h)[i]!.as_integer().to_str()
const credAt = (h: string, i: number): { kind: string; hashHex: string } => {
  const c = fieldsOf(h)[i]!.as_constr_plutus_data()
  return { kind: c.alternative() === 1n ? "script" : "key", hashHex: hex(c.fields().get(0).as_bytes()) }
}

// ── fixtures ────────────────────────────────────────────────────────────────────

const KEY = h28("a1")
const NEXT = h28("b2")
const MINT = h28("c3")
const TRANSFER_LOGIC = h28("d4")
const THIRD_PARTY_LOGIC = h28("e5")
const UNFRACK_LOGIC = h28("f6")
const GLOBAL_STATE = h28("07")

const node: Cip113.RegistryNode = {
  keyHex: KEY,
  nextHex: NEXT,
  mintingLogicScript: { kind: "script", hashHex: MINT },
  transferLogicScript: { kind: "script", hashHex: TRANSFER_LOGIC },
  thirdPartyTransferLogicScript: { kind: "script", hashHex: THIRD_PARTY_LOGIC },
  unfrackingLogicScript: { kind: "script", hashHex: UNFRACK_LOGIC },
  globalStateCsHex: GLOBAL_STATE,
}

describe("the registry-node inline datum", () => {
  const latest = run(Cip113.registryNodeDatum(node))

  it("is the 7-field Constr 0 the post-audit shape declares [RULE]", () => {
    expect(latest).toBe(
      `d8799f${`581c${KEY}`}${`581c${NEXT}`}${`d87a9f581c${MINT}ff`}${`d87a9f581c${TRANSFER_LOGIC}ff`}` +
        `${`d87a9f581c${THIRD_PARTY_LOGIC}ff`}${`d87a9f581c${UNFRACK_LOGIC}ff`}${`581c${GLOBAL_STATE}`}ff`
    )
  })

  it("reads back, through CML, as the fields we meant [READS]", () => {
    expect(parse(latest).to_cbor_hex()).toBe(latest)
    expect(constrOf(latest).alternative()).toBe(0n)
    expect(fieldsOf(latest).length).toBe(7)
    expect(bytesAt(latest, 0)).toBe(KEY)
    expect(bytesAt(latest, 1)).toBe(NEXT)
    expect(credAt(latest, 2)).toEqual({ kind: "script", hashHex: MINT })
    expect(credAt(latest, 3)).toEqual({ kind: "script", hashHex: TRANSFER_LOGIC })
    expect(credAt(latest, 4)).toEqual({ kind: "script", hashHex: THIRD_PARTY_LOGIC })
    expect(credAt(latest, 5)).toEqual({ kind: "script", hashHex: UNFRACK_LOGIC })
    expect(bytesAt(latest, 6)).toBe(GLOBAL_STATE)
  })

  it("drops minting_logic and unfracking_logic on v0.3.0, shifting the rest [RULE]", () => {
    const old = run(Cip113.registryNodeDatum(node, V0_3_0))
    expect(old).toBe(
      `d8799f${`581c${KEY}`}${`581c${NEXT}`}${`d87a9f581c${TRANSFER_LOGIC}ff`}` +
        `${`d87a9f581c${THIRD_PARTY_LOGIC}ff`}${`581c${GLOBAL_STATE}`}ff`
    )
    expect(fieldsOf(old).length).toBe(5)
    // The shift is the whole hazard: field 2 is the TRANSFER logic here and the MINTING logic above.
    expect(credAt(old, 2)).toEqual({ kind: "script", hashHex: TRANSFER_LOGIC })
  })

  it("emits identical bytes for every 7-field version, which is the descriptors' doing", () => {
    // v0.4.0, alpha.2 and alpha.4 all declare the same node layout, so a node datum cannot
    // identify a generation. If a future layout change makes two of these differ, this fails and
    // the version-dispatch above it has to be revisited rather than discovered on chain.
    const seven = [LATEST, V0_0_1, V0_5_0_ALPHA_4, V0_5_0_ALPHA_2, V0_4_0].map((v) =>
      run(Cip113.registryNodeDatum(node, v))
    )
    expect(new Set(seven).size).toBe(1)
    expect(seven[0]).toBe(latest)
    expect(run(Cip113.registryNodeDatum(node, V0_3_0))).not.toBe(latest)
  })

  it("keeps the origin key empty and the sentinel 30 bytes long [RULE]", () => {
    const edge = run(
      Cip113.registryNodeDatum({ ...node, keyHex: Cip113.ORIGIN_NODE_KEY, nextHex: Cip113.SENTINEL_NEXT_KEY })
    )
    // `40` is the empty bytestring and `581e` a 30-byte one. The length is load-bearing: Plutus
    // compares bytestrings with the shorter one smaller on a prefix tie, so a sentinel normalised
    // to 28 bytes of `ff` would stop being greater than a 28-byte policy id that is also all-`ff`.
    expect(edge.startsWith("d8799f40581e")).toBe(true)
    expect(bytesAt(edge, 0)).toBe("")
    expect(bytesAt(edge, 1)).toBe("ff".repeat(30))
  })

  it("encodes an absent credential as the empty-key sentinel, not as a missing field [RULE]", () => {
    const absent = run(Cip113.registryNodeDatum({ ...node, unfrackingLogicScript: Cip113.ABSENT_CRED }))
    expect(fieldsOf(absent).length).toBe(7)
    expect(absent).toContain("d8799f40ff")
    expect(credAt(absent, 5)).toEqual({ kind: "key", hashHex: "" })
  })
})

describe("the registry proof", () => {
  it("names membership by constructor, not by a flag field [RULE]", () => {
    expect(run(Cip113.registryProofData({ kind: "exists", nodeIdx: 0 }))).toBe("d8799f00ff")
    expect(run(Cip113.registryProofData({ kind: "notExists", nodeIdx: 3 }))).toBe("d87a9f03ff")
  })

  it("reads back as TokenExists / TokenDoesNotExist with the index [READS]", () => {
    const e = run(Cip113.registryProofData({ kind: "exists", nodeIdx: 7 }))
    const n = run(Cip113.registryProofData({ kind: "notExists", nodeIdx: 7 }))
    expect(constrOf(e).alternative()).toBe(0n)
    expect(constrOf(n).alternative()).toBe(1n)
    expect(intAt(e, 0)).toBe("7")
    expect(intAt(n, 0)).toBe("7")
  })

  it("encodes an index past the one-byte uint boundary as CBOR does [RULE]", () => {
    // 23 is its own byte, 24 needs the one-byte follow form. An index is a list position and 24
    // reference inputs is an ordinary transaction, so this boundary is reachable.
    expect(run(Cip113.registryProofData({ kind: "exists", nodeIdx: 23 }))).toBe("d8799f17ff")
    expect(run(Cip113.registryProofData({ kind: "exists", nodeIdx: 24 }))).toBe("d8799f1818ff")
  })
})

describe("the transfer withdraw-0 redeemer", () => {
  const proofs = [
    { kind: "exists", nodeIdx: 1 },
    { kind: "notExists", nodeIdx: 2 },
  ] as const

  it("carries params_idx on alpha.2 and omits it on LATEST [RULE]", () => {
    const a2 = run(Cip113.transferRedeemer({ paramsIdx: 1, proofs }, V0_5_0_ALPHA_2))
    const latest = run(Cip113.transferRedeemer({ paramsIdx: 1, proofs }))
    expect(a2).toBe("d8799f019fd8799f01ffd87a9f02ffffff")
    expect(latest).toBe("d8799f9fd8799f01ffd87a9f02ffffff")
    expect(fieldsOf(a2).length).toBe(2)
    expect(fieldsOf(latest).length).toBe(1)
    expect(intAt(a2, 0)).toBe("1")
  })

  it("gives LATEST and the pre-split TransferAct the same bytes, as upstream does", () => {
    // Asserted rather than assumed: the descriptor keeps 'proofs-only' and 'transfer-act'
    // distinct so the next divergence is a one-line change, and if one moves without the other
    // this is what says so.
    const latest = run(Cip113.transferRedeemer({ paramsIdx: 1, proofs }))
    expect(run(Cip113.transferRedeemer({ paramsIdx: 1, proofs }, V0_4_0))).toBe(latest)
    expect(run(Cip113.transferRedeemer({ paramsIdx: 1, proofs }, V0_3_0))).toBe(latest)
    expect(run(Cip113.transferActRedeemer(proofs))).toBe(latest)
  })

  it("ignores params_idx entirely where the version has no such field", () => {
    const a = run(Cip113.transferRedeemer({ paramsIdx: 0, proofs }))
    const b = run(Cip113.transferRedeemer({ paramsIdx: 99, proofs }))
    expect(a).toBe(b)
  })

  it("frames an empty proof list definite and a non-empty one indefinite [RULE]", () => {
    // ⚠️ The asymmetry is Evolution's encoding rule, not a choice here, and it is load-bearing:
    // `80` and `9fff` are both legal empty arrays with different bytes, so a datum re-encoded
    // under the other convention hashes differently.
    expect(run(Cip113.transferActRedeemer([]))).toBe("d8799f80ff")
    expect(run(Cip113.transferActRedeemer([{ kind: "exists", nodeIdx: 0 }]))).toBe("d8799f9fd8799f00ffffff")
    expect(parse("d8799f80ff").to_cbor_hex()).toBe("d8799f80ff")
  })

  it("keeps proofs in the order given, since the delegate pairs them positionally [READS]", () => {
    const ordered = run(Cip113.transferActRedeemer(proofs))
    const reversed = run(Cip113.transferActRedeemer([...proofs].reverse()))
    expect(ordered).not.toBe(reversed)
    const list = fieldsOf(ordered)[0]!.as_list()
    expect(list.get(0).as_constr_plutus_data().alternative()).toBe(0n)
    expect(list.get(1).as_constr_plutus_data().alternative()).toBe(1n)
  })
})

describe("the PLB spend redeemer", () => {
  const args = { arm: "transfer", paramsIdx: 4, wdrlIdx: 2 } as const

  it("is two indices on LATEST and a named arm plus two indices on alpha.2 [RULE]", () => {
    expect(run(Cip113.plbSpendRedeemer(args))).toBe("d8799f0402ff")
    expect(run(Cip113.plbSpendRedeemer(args, V0_5_0_ALPHA_2))).toBe("d8799f0402ff")
    expect(run(Cip113.plbSpendRedeemer({ ...args, arm: "thirdParty" }, V0_5_0_ALPHA_2))).toBe("d87a9f0402ff")
    expect(run(Cip113.plbSpendRedeemer({ ...args, arm: "unfracking" }, V0_5_0_ALPHA_2))).toBe("d87b9f0402ff")
  })

  it("ignores the arm on LATEST, where the dispatcher names the action", () => {
    // ⚠️ The transfer arm is the SAME BYTES at both versions, which is why the descriptor has to
    // be right: a wrong one encodes and decodes fine and fails on chain as a withdrawal mismatch,
    // because the two versions index different credentials.
    const arms = (["transfer", "thirdParty", "unfracking"] as const).map((arm) =>
      run(Cip113.plbSpendRedeemer({ ...args, arm }))
    )
    expect(new Set(arms).size).toBe(1)
    expect(arms[0]).toBe(run(Cip113.plbSpendRedeemer(args, V0_5_0_ALPHA_2)))
  })

  it("is a Plutus unit before the split, where PLB ignored its redeemer [BYTES]", () => {
    const unit = run(Cip113.plbSpendRedeemer(args, V0_4_0))
    expect(unit).toBe("d87980")
    // Field-less, so both tools emit the definite empty form and the comparison is apt.
    expect(unit).toBe(cmlConstr(0n, []).to_cbor_hex())
    expect(run(Cip113.plbSpendRedeemer(args, V0_3_0))).toBe(unit)
  })

  it("puts params_idx before wdrl_idx, which the ledger cannot tell apart [READS]", () => {
    // Two ints of the same type: swapping them is invisible to every decoder and fails only in
    // phase 2. Distinct values are the only way to see the order at all.
    const r = run(Cip113.plbSpendRedeemer({ arm: "transfer", paramsIdx: 9, wdrlIdx: 1 }))
    expect(intAt(r, 0)).toBe("9")
    expect(intAt(r, 1)).toBe("1")
  })
})

describe("the dispatcher redeemer", () => {
  it("names the action in the constructor and carries no fields [BYTES]", () => {
    expect(run(Cip113.plgDispatchRedeemer("transfer"))).toBe("d87980")
    expect(run(Cip113.plgDispatchRedeemer("thirdParty"))).toBe("d87a80")
    expect(run(Cip113.plgDispatchRedeemer("unfracking"))).toBe("d87b80")
    expect(run(Cip113.plgDispatchRedeemer("transfer"))).toBe(cmlConstr(0n, []).to_cbor_hex())
    expect(run(Cip113.plgDispatchRedeemer("thirdParty"))).toBe(cmlConstr(1n, []).to_cbor_hex())
    expect(run(Cip113.plgDispatchRedeemer("unfracking"))).toBe(cmlConstr(2n, []).to_cbor_hex())
  })

  it("shares the PLB arm numbering, so one table decides both", () => {
    const plbArms = (["transfer", "thirdParty", "unfracking"] as const).map(
      (arm) => constrOf(run(Cip113.plbSpendRedeemer({ arm, paramsIdx: 0, wdrlIdx: 0 }, V0_5_0_ALPHA_2))).alternative()
    )
    const plgArms = (["transfer", "thirdParty", "unfracking"] as const).map(
      (arm) => constrOf(run(Cip113.plgDispatchRedeemer(arm))).alternative()
    )
    expect(plbArms).toEqual([0n, 1n, 2n])
    expect(plgArms).toEqual([0n, 1n, 2n])
  })
})

describe("the third-party and unfracking redeemers", () => {
  const indices = { paramsIdx: 1, registryNodeIdx: 2, outputsStartIdx: 3 }

  it("drops params_idx on LATEST and keeps it on alpha.2 [RULE]", () => {
    expect(run(Cip113.thirdPartyRedeemer(indices))).toBe("d8799f0203ff")
    expect(run(Cip113.thirdPartyRedeemer(indices, V0_5_0_ALPHA_2))).toBe("d8799f010203ff")
    expect(fieldsOf(run(Cip113.thirdPartyRedeemer(indices))).length).toBe(2)
    expect(fieldsOf(run(Cip113.thirdPartyRedeemer(indices, V0_5_0_ALPHA_2))).length).toBe(3)
  })

  it("gives unfracking the same wire shape as third-party at every version", () => {
    for (const v of [LATEST, V0_5_0_ALPHA_2, V0_4_0, V0_3_0]) {
      expect(run(Cip113.unfrackingRedeemer(indices, v))).toBe(run(Cip113.thirdPartyRedeemer(indices, v)))
    }
  })

  it("orders registry_node_idx before outputs_start_idx [READS]", () => {
    const r = run(Cip113.thirdPartyRedeemer({ paramsIdx: 0, registryNodeIdx: 5, outputsStartIdx: 8 }))
    expect(intAt(r, 0)).toBe("5")
    expect(intAt(r, 1)).toBe("8")
  })
})

describe("the smart-wallet address and the delegate reward account", () => {
  const PLB = h28("0a")
  const OWNER = h28("0b")

  it("is a base address: PLB script pays, the owner's credential stakes [BYTES]", () => {
    const addr = Cip113.smartWalletAddressHex(Network.Testnet, PLB, { kind: "key", hashHex: OWNER })
    expect(addr).toBe(`10${PLB}${OWNER}`)
    const ba = CML.BaseAddress.from_address(CML.Address.from_hex(addr))
    expect(CML.Address.from_hex(addr).network_id()).toBe(0)
    expect(ba.payment().to_cbor_hex()).toBe(`8201581c${PLB}`)
    expect(ba.stake().to_cbor_hex()).toBe(`8200581c${OWNER}`)
  })

  it("selects the header type from the STAKE credential's kind [BYTES]", () => {
    // Header nibble 1 = script payment + key stake, 3 = script payment + script stake. The
    // payment credential is the shared PLB script either way, so the owner's kind is the only
    // thing this reads, and getting it wrong yields a well-formed address holding nothing.
    const keyStake = Cip113.smartWalletAddressHex(Network.Mainnet, PLB, { kind: "key", hashHex: OWNER })
    const scriptStake = Cip113.smartWalletAddressHex(Network.Mainnet, PLB, { kind: "script", hashHex: OWNER })
    expect(keyStake).toBe(`11${PLB}${OWNER}`)
    expect(scriptStake).toBe(`31${PLB}${OWNER}`)
    expect(CML.BaseAddress.from_address(CML.Address.from_hex(scriptStake)).stake().to_cbor_hex()).toBe(
      `8201581c${OWNER}`
    )
  })

  it("makes the delegate's withdraw-zero account a script reward address [BYTES]", () => {
    const acct = Cip113.delegateRewardAccountHex(Network.Testnet, h28("ee"))
    expect(acct).toBe(`f0${h28("ee")}`)
    const ra = CML.RewardAddress.from_address(CML.Address.from_hex(acct))
    expect(ra.payment().to_cbor_hex()).toBe(`8201581c${h28("ee")}`)
  })

  it("keeps the deprecated plgRewardAccountHex alias behaviour-identical", () => {
    expect(Cip113.plgRewardAccountHex(Network.Testnet, h28("ee"))).toBe(
      Cip113.delegateRewardAccountHex(Network.Testnet, h28("ee"))
    )
  })
})

// ── decode ──────────────────────────────────────────────────────────────────────

describe("decoding a registry node", () => {
  /** A 7-field node datum built by CML, so the decoder is never fed our own encoder's bytes. */
  const oracleNode = cmlConstr(0n, [
    cmlBytes(KEY),
    cmlBytes(NEXT),
    cmlCred("script", MINT),
    cmlCred("script", TRANSFER_LOGIC),
    cmlCred("key", THIRD_PARTY_LOGIC),
    cmlCred("script", UNFRACK_LOGIC),
    cmlBytes(GLOBAL_STATE),
  ]).to_cbor_hex()

  it("reads every field at the version's position", () => {
    expect(run(Cip113.decodeRegistryNode(oracleNode))).toEqual({
      keyHex: KEY,
      nextHex: NEXT,
      mintingLogicScript: { kind: "script", hashHex: MINT },
      transferLogicScript: { kind: "script", hashHex: TRANSFER_LOGIC },
      thirdPartyTransferLogicScript: { kind: "key", hashHex: THIRD_PARTY_LOGIC },
      unfrackingLogicScript: { kind: "script", hashHex: UNFRACK_LOGIC },
      globalStateCsHex: GLOBAL_STATE,
    })
  })

  it("round-trips our encoder's definite-free framing too", () => {
    expect(run(Cip113.decodeRegistryNode(run(Cip113.registryNodeDatum(node))))).toEqual(node)
  })

  it("reports the fields a version does not have as absent, not as the next field along", () => {
    const five = cmlConstr(0n, [
      cmlBytes(KEY),
      cmlBytes(NEXT),
      cmlCred("script", TRANSFER_LOGIC),
      cmlCred("script", THIRD_PARTY_LOGIC),
      cmlBytes(GLOBAL_STATE),
    ]).to_cbor_hex()
    expect(run(Cip113.decodeRegistryNode(five, V0_3_0))).toEqual({
      keyHex: KEY,
      nextHex: NEXT,
      mintingLogicScript: Cip113.ABSENT_CRED,
      transferLogicScript: { kind: "script", hashHex: TRANSFER_LOGIC },
      thirdPartyTransferLogicScript: { kind: "script", hashHex: THIRD_PARTY_LOGIC },
      unfrackingLogicScript: Cip113.ABSENT_CRED,
      globalStateCsHex: GLOBAL_STATE,
    })
  })

  it("refuses a 7-field node read with the 5-field descriptor, and the reason is luck", () => {
    // ⚠️ Measured, not assumed. A v0.3.0 reader against a post-audit node DOES throw — but on
    // `global_state_cs`, because v0.3.0 reads bytes at index 4 where the 7-field layout has the
    // third-party credential. The credential fields it read before that were already mislabelled
    // (index 2 is the MINTING logic there, not the transfer logic), so what makes this direction
    // loud is a type collision at index 4, not a check that the shapes match. The 7-field layout
    // always has a credential at 4, so the direction is reliably loud today and would go silent
    // the moment a revision put a bytestring there.
    expect(fail(Cip113.decodeRegistryNode(oracleNode, V0_3_0)).message).toContain("expected plutus bytes")
  })

  it("refuses a 5-field node read with the 7-field descriptor, on arity", () => {
    const five = cmlConstr(0n, [
      cmlBytes(KEY),
      cmlBytes(NEXT),
      cmlCred("script", TRANSFER_LOGIC),
      cmlCred("script", THIRD_PARTY_LOGIC),
      cmlBytes(GLOBAL_STATE),
    ]).to_cbor_hex()
    expect(fail(Cip113.decodeRegistryNode(five)).message).toContain("needs 7 fields, got 5")
  })

  it("accepts MORE fields than the version declares, matching the on-chain reader", () => {
    const extra = cmlConstr(0n, [...Array.from({ length: 7 }, (_, i) => fieldsOf(oracleNode)[i]!), cmlInt("1")])
    expect(run(Cip113.decodeRegistryNode(extra.to_cbor_hex()))).toEqual(
      run(Cip113.decodeRegistryNode(oracleNode))
    )
  })

  it("refuses fewer fields, the wrong constructor, and a non-credential in a credential slot", () => {
    const short = cmlConstr(0n, [cmlBytes(KEY), cmlBytes(NEXT)]).to_cbor_hex()
    expect(fail(Cip113.decodeRegistryNode(short)).message).toContain("needs 7 fields, got 2")
    const alt1 = cmlConstr(1n, Array.from({ length: 7 }, (_, i) => fieldsOf(oracleNode)[i]!)).to_cbor_hex()
    expect(fail(Cip113.decodeRegistryNode(alt1)).message).toContain("must be Constr 0")
    const bad = cmlConstr(0n, [
      cmlBytes(KEY),
      cmlBytes(NEXT),
      cmlInt("1"),
      cmlCred("script", TRANSFER_LOGIC),
      cmlCred("script", THIRD_PARTY_LOGIC),
      cmlCred("script", UNFRACK_LOGIC),
      cmlBytes(GLOBAL_STATE),
    ]).to_cbor_hex()
    expect(fail(Cip113.decodeRegistryNode(bad)).message).toContain("Credential Constr")
    const notConstr = CML.PlutusData.new_bytes(B(KEY)).to_cbor_hex()
    expect(fail(Cip113.decodeRegistryNode(notConstr)).message).toContain("expected plutus constr, got bytes")
  })

  it("refuses a credential whose alternative is neither key nor script", () => {
    const cred2 = cmlConstr(2n, [cmlBytes(MINT)])
    const bad = cmlConstr(0n, [
      cmlBytes(KEY),
      cmlBytes(NEXT),
      cred2,
      cmlCred("script", TRANSFER_LOGIC),
      cmlCred("script", THIRD_PARTY_LOGIC),
      cmlCred("script", UNFRACK_LOGIC),
      cmlBytes(GLOBAL_STATE),
    ]).to_cbor_hex()
    expect(fail(Cip113.decodeRegistryNode(bad)).message).toContain("alt must be 0 or 1")
  })
})

describe("decoding the protocol-params datum", () => {
  const PLG = h28("11")
  const ISSUANCE = h28("22")
  const TRANSFER = h28("33")
  const THIRD = h28("44")
  const UPGRADE = h28("55")
  const REGISTRY_CS = h28("66")
  const PROG_LOGIC = h28("77")
  const UNFRACK = h28("88")

  /** `0.5.0-alpha.4` / v0.0.1: plg, issuance_logic, transfer, third_party, upgrade, pending. */
  const alpha4 = cmlConstr(0n, [
    cmlCred("script", PLG),
    cmlCred("script", ISSUANCE),
    cmlCred("script", TRANSFER),
    cmlCred("script", THIRD),
    cmlCred("script", UPGRADE),
    cmlConstr(1n, []),
  ]).to_cbor_hex()

  /** `0.5.0-alpha.2`: registry_cs, prog_logic, transfer, third_party, unfracking, upgrade, bound. */
  const alpha2 = cmlConstr(0n, [
    cmlBytes(REGISTRY_CS),
    cmlCred("script", PROG_LOGIC),
    cmlCred("script", TRANSFER),
    cmlCred("script", THIRD),
    cmlCred("script", UNFRACK),
    cmlCred("script", UPGRADE),
    cmlInt("512"),
  ]).to_cbor_hex()

  it("reads the post-audit datum, and says 'no handover in flight' rather than 'no field'", () => {
    expect(run(Cip113.decodeGlobalParams(alpha4))).toEqual({
      plgCred: { kind: "script", hashHex: PLG },
      issuanceLogicCred: { kind: "script", hashHex: ISSUANCE },
      transferCred: { kind: "script", hashHex: TRANSFER },
      thirdPartyCred: { kind: "script", hashHex: THIRD },
      upgradeCred: { kind: "script", hashHex: UPGRADE },
      pendingUpgradeCred: null,
    })
  })

  it("distinguishes a None nomination from a Some one", () => {
    const nominated = cmlConstr(0n, [
      ...Array.from({ length: 5 }, (_, i) => fieldsOf(alpha4)[i]!),
      cmlConstr(0n, [cmlCred("key", UPGRADE)]),
    ]).to_cbor_hex()
    expect(run(Cip113.decodeGlobalParams(nominated)).pendingUpgradeCred).toEqual({ kind: "key", hashHex: UPGRADE })
    expect(run(Cip113.decodeGlobalParams(alpha4)).pendingUpgradeCred).toBeNull()
  })

  it("reads the alpha.2 datum, bound and all", () => {
    expect(run(Cip113.decodeGlobalParams(alpha2, V0_5_0_ALPHA_2))).toEqual({
      registryNodeCsHex: REGISTRY_CS,
      progLogicCred: { kind: "script", hashHex: PROG_LOGIC },
      transferCred: { kind: "script", hashHex: TRANSFER },
      thirdPartyCred: { kind: "script", hashHex: THIRD },
      unfrackingCred: { kind: "script", hashHex: UNFRACK },
      upgradeCred: { kind: "script", hashHex: UPGRADE },
      maxInlineDatumBytes: 512n,
    })
  })

  it("⚠️ the v0.4.0 descriptor against an alpha.2 datum succeeds and relabels field 2", () => {
    // Documented upstream and reproduced here: v0.4.0's index 2 is `unfracking_cred` while
    // alpha.2's is `transfer_cred`, so the transfer credential comes back under the wrong name
    // and the decode says nothing.
    expect(run(Cip113.decodeGlobalParams(alpha2, V0_4_0))).toEqual({
      registryNodeCsHex: REGISTRY_CS,
      progLogicCred: { kind: "script", hashHex: PROG_LOGIC },
      unfrackingCred: { kind: "script", hashHex: TRANSFER },
    })
  })

  it("⚠️ the alpha.2 descriptor against a post-audit datum fails on ARITY, not on field 0", () => {
    // ⚠️ Measured. The module doc used to say this read "throws on field 0 — a Credential where a
    // ByteArray was expected". It does not get that far: alpha.4 removed four fields, so the
    // datum has 6 and alpha.2 wants 7, and the arity check fires first. Which matters, because
    // arity is the accident here — the next revision to APPEND a field restores the count and
    // leaves only the type check standing (the case below).
    expect(fail(Cip113.decodeGlobalParams(alpha4, V0_5_0_ALPHA_2)).message).toContain("needs 7 fields, got 6")
  })

  it("⚠️ and when the arity happens to agree, field 0's type check is the only guard left", () => {
    // A post-audit datum with one appended field has alpha.2's arity and alpha.4's order. The
    // type check holds here only because field 0 changed from a bytestring to a Credential; a
    // reorder that kept the types would come back silently wrong.
    const seven = cmlConstr(0n, [
      ...Array.from({ length: 6 }, (_, i) => fieldsOf(alpha4)[i]!),
      cmlInt("512"),
    ]).to_cbor_hex()
    expect(fail(Cip113.decodeGlobalParams(seven, V0_5_0_ALPHA_2)).message).toContain("expected plutus bytes")
  })

  it("refuses a datum with fewer fields than the version declares", () => {
    const two = cmlConstr(0n, [cmlBytes(REGISTRY_CS), cmlCred("script", PROG_LOGIC)]).to_cbor_hex()
    expect(run(Cip113.decodeGlobalParams(two, V0_3_0))).toEqual({
      registryNodeCsHex: REGISTRY_CS,
      progLogicCred: { kind: "script", hashHex: PROG_LOGIC },
    })
    expect(fail(Cip113.decodeGlobalParams(two, V0_5_0_ALPHA_2)).message).toContain("needs 7 fields, got 2")
  })

  it("refuses the wrong constructor", () => {
    const alt = cmlConstr(1n, Array.from({ length: 6 }, (_, i) => fieldsOf(alpha4)[i]!)).to_cbor_hex()
    expect(fail(Cip113.decodeGlobalParams(alt)).message).toContain("must be Constr 0")
  })

  it("refuses an inline-datum bound that needs the bignum form", () => {
    // The bound is a byte count, so a value past 64 bits is not a number this protocol carries;
    // reinterpreting it silently would be worse than refusing it.
    const huge = cmlConstr(0n, [
      ...Array.from({ length: 6 }, (_, i) => fieldsOf(alpha2)[i]!),
      cmlInt((2n ** 64n).toString()),
    ]).to_cbor_hex()
    expect(fail(Cip113.decodeGlobalParams(huge, V0_5_0_ALPHA_2)).message).toContain("got bigint")
    const max = cmlConstr(0n, [
      ...Array.from({ length: 6 }, (_, i) => fieldsOf(alpha2)[i]!),
      cmlInt((2n ** 64n - 1n).toString()),
    ]).to_cbor_hex()
    expect(run(Cip113.decodeGlobalParams(max, V0_5_0_ALPHA_2)).maxInlineDatumBytes).toBe(2n ** 64n - 1n)
  })

  it("refuses an Option that is neither Some nor None", () => {
    const bogus = cmlConstr(0n, [
      ...Array.from({ length: 5 }, (_, i) => fieldsOf(alpha4)[i]!),
      cmlConstr(0n, []),
    ]).to_cbor_hex()
    expect(fail(Cip113.decodeGlobalParams(bogus)).message).toContain("not an Option<Credential>")
  })
})
