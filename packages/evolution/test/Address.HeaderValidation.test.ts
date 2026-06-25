import { bech32 } from "@scure/base"
import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as RewardAccount from "../src/RewardAccount.js"

describe("Address header validation (CIP-19)", () => {
  const keyHash = KeyHash.fromPrivateKey(PrivateKey.fromBytes(PrivateKey.generate()))

  it("rejects a reward address supplied as hex (was parsed as Enterprise)", () => {
    const reward = new RewardAccount.RewardAccount({ networkId: 1, stakeCredential: keyHash })
    const rewardHex = RewardAccount.toHex(reward)
    // sanity: 0xe1 = reward, stake-key, mainnet — same 29-byte length as Enterprise
    expect(rewardHex.slice(0, 2)).toBe("e1")
    expect(() => Address.fromHex(rewardHex)).toThrow()
  })

  it("rejects a stake1... bech32 string", () => {
    const reward = new RewardAccount.RewardAccount({ networkId: 1, stakeCredential: keyHash })
    const stakeBech32 = RewardAccount.toBech32(reward)
    expect(stakeBech32.startsWith("stake1")).toBe(true)
    expect(() => Address.fromBech32(stakeBech32)).toThrow()
  })

  it("rejects a bech32 prefix that disagrees with the network", () => {
    // Testnet enterprise payload (networkId 0) encoded under the mainnet "addr" prefix
    const enterprise = new Address.Address({ networkId: 0, paymentCredential: keyHash })
    const mislabeled = bech32.encode("addr", bech32.toWords(Address.toBytes(enterprise)), false)
    expect(() => Address.fromBech32(mislabeled)).toThrow()
  })

  it("rejects a non-enterprise type in the 29-byte branch", () => {
    // 0x41 = type 4 (pointer), mainnet — must not be accepted as Enterprise
    const pointerHex = "41" + Bytes.toHex(keyHash.hash)
    expect(() => Address.fromHex(pointerHex)).toThrow()
  })

  it("still parses a valid enterprise address round-trip", () => {
    const enterprise = new Address.Address({ networkId: 0, paymentCredential: keyHash })
    const parsed = Address.fromHex(Address.toHex(enterprise))
    expect(parsed.paymentCredential._tag).toBe("KeyHash")
    expect(parsed.stakingCredential).toBeUndefined()

    const bech = Address.toBech32(enterprise)
    expect(bech.startsWith("addr_test1")).toBe(true)
    expect(Address.fromBech32(bech).networkId).toBe(0)
  })

  it("still parses a valid base address round-trip", () => {
    const base = new Address.Address({ networkId: 1, paymentCredential: keyHash, stakingCredential: keyHash })
    const parsed = Address.fromHex(Address.toHex(base))
    expect(parsed.paymentCredential._tag).toBe("KeyHash")
    expect(parsed.stakingCredential?._tag).toBe("KeyHash")
  })
})
