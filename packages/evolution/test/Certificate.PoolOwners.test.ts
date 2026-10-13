import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, expect, it } from "vitest"

import * as Certificate from "../src/Certificate.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PoolKeyHash from "../src/PoolKeyHash.js"
import * as PoolParams from "../src/PoolParams.js"
import * as RewardAccount from "../src/RewardAccount.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as UnitInterval from "../src/UnitInterval.js"
import * as VrfKeyHash from "../src/VrfKeyHash.js"

/**
 * `pool_params.pool_owners` is `set<addr_keyhash>`: the chain and CML both write it `#6.258`.
 * It used to go out as a bare array and, worse, the tagged form could not be decoded at all —
 * neither on its own nor inside a transaction body, which is every consumer reading a stake-pool
 * registration off the chain.
 */
describe("Certificate pool_owners is a Conway set", () => {
  const fill = (n: number, b: number) => new Uint8Array(n).fill(b)
  const hex = (n: number, b: number) => Buffer.from(fill(n, b)).toString("hex")

  const certificate = new Certificate.PoolRegistration({
    poolParams: new PoolParams.PoolParams({
      operator: PoolKeyHash.fromHex(hex(28, 2)),
      vrfKeyhash: VrfKeyHash.fromHex(hex(32, 8)),
      pledge: 100000000n,
      cost: 340000000n,
      margin: new UnitInterval.UnitInterval({ numerator: 1n, denominator: 50n }),
      rewardAccount: RewardAccount.fromHex(`e0${hex(28, 0xab)}`),
      poolOwners: [KeyHash.fromHex(hex(28, 1)), KeyHash.fromHex(hex(28, 6))],
      relays: [],
      poolMetadata: undefined
    })
  })

  /** The same certificate built by CML from its own parts — not a round trip of ours. */
  const cmlHex = (() => {
    const kh = (b: number) => CML.Ed25519KeyHash.from_raw_bytes(fill(28, b))
    const owners = CML.Ed25519KeyHashList.new()
    owners.add(kh(1))
    owners.add(kh(6))
    const params = CML.PoolParams.new(
      kh(2),
      CML.VRFKeyHash.from_raw_bytes(fill(32, 8)),
      100000000n,
      340000000n,
      CML.UnitInterval.new(1n, 50n),
      CML.RewardAddress.new(0, CML.Credential.new_pub_key(kh(0xab))),
      owners,
      CML.RelayList.new(),
      undefined
    )
    return CML.Certificate.new_pool_registration(params).to_cbor_hex()
  })()

  const taggedHex = Certificate.toCBORHex(certificate)
  const ownersAt = taggedHex.indexOf("d90102", taggedHex.indexOf("d81e"))
  const untaggedHex = taggedHex.slice(0, ownersAt) + taggedHex.slice(ownersAt + "d90102".length)

  it("writes pool_owners as #6.258, byte-for-byte with CML", () => {
    expect(cmlHex).toContain("d90102")
    expect(taggedHex).toBe(cmlHex)
  })

  it("decodes the tagged form, and still accepts a bare array", () => {
    expect(ownersAt).toBeGreaterThan(0)
    expect(Certificate.fromCBORHex(taggedHex)).toStrictEqual(certificate)
    expect(Certificate.fromCBORHex(untaggedHex)).toStrictEqual(certificate)
  })

  it("PoolParams on its own writes and reads the same set form", () => {
    // `Certificate` flattens `PoolParams.CDDLSchema` but declares its own copy of the slot, so
    // the standalone codec is a separate path and needs its own assertion.
    const paramsHex = PoolParams.toHex(certificate.poolParams)
    expect(paramsHex).toContain("d90102")
    expect(PoolParams.fromHex(paramsHex)).toStrictEqual(certificate.poolParams)

    const at = paramsHex.indexOf("d90102", paramsHex.indexOf("d81e"))
    const bare = paramsHex.slice(0, at) + paramsHex.slice(at + "d90102".length)
    expect(PoolParams.fromHex(bare)).toStrictEqual(certificate.poolParams)
  })

  it("decodes the tagged form inside a transaction body", () => {
    const body = new TransactionBody.TransactionBody({
      inputs: [],
      outputs: [],
      fee: 200000n,
      certificates: [certificate]
    })
    const bodyHex = TransactionBody.toCBORHex(body)
    // The body carries the certificate verbatim, tag included (minus the outer array header).
    expect(bodyHex).toContain(taggedHex.slice(2))
    // This used to throw: the tagged inner set was rejected before the certificate transform ran,
    // so no transaction registering a stake pool could be decoded at all.
    const decoded = TransactionBody.fromCBORHex(bodyHex)
    expect(decoded.certificates).toStrictEqual([certificate])
    expect(TransactionBody.toCBORHex(decoded)).toBe(bodyHex)
  })
})
