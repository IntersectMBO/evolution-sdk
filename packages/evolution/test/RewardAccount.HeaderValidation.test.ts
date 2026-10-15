import { bech32 } from "@scure/base"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as RewardAccount from "../src/RewardAccount.js"
import * as ScriptHash from "../src/ScriptHash.js"

describe("RewardAccount header and prefix validation (CIP-19)", () => {
  const keyHash = KeyHash.fromPrivateKey(PrivateKey.fromBytes(PrivateKey.generate()))
  const hashHex = Bytes.toHex(keyHash.hash)

  it("rejects a non-reward header type supplied as hex", () => {
    // 0x61 = type 6 (enterprise, key), mainnet — a payment address header, not a reward one
    expect(() => RewardAccount.fromHex("61" + hashHex)).toThrow(/Invalid reward address type: 6/)
    // 0x41 = type 4 (pointer), mainnet
    expect(() => RewardAccount.fromHex("41" + hashHex)).toThrow(/Invalid reward address type: 4/)
    // 0x01 = type 0 (base, key/key), mainnet
    expect(() => RewardAccount.fromHex("01" + hashHex)).toThrow(/Invalid reward address type: 0/)
  })

  it("rejects a non-reward header type supplied as bytes", () => {
    const enterpriseBytes = Bytes.fromHex("61" + hashHex)
    expect(() => RewardAccount.fromBytes(enterpriseBytes)).toThrow(/Invalid reward address type: 6/)
  })

  it("rejects a non-stake bech32 prefix", () => {
    const reward = new RewardAccount.RewardAccount({ networkId: 1, stakeCredential: keyHash })
    const bytes = RewardAccount.toBytes(reward)
    const addrBech32 = bech32.encode("addr", bech32.toWords(bytes), false)
    expect(() => RewardAccount.fromBech32(addrBech32)).toThrow(/Invalid reward account prefix: addr/)
    const addrTestBech32 = bech32.encode("addr_test", bech32.toWords(bytes), false)
    expect(() => RewardAccount.fromBech32(addrTestBech32)).toThrow(/Invalid reward account prefix: addr_test/)
  })

  it("rejects a stake prefix that disagrees with the network", () => {
    // Testnet reward payload (networkId 0) encoded under the mainnet "stake" prefix
    const testnet = new RewardAccount.RewardAccount({ networkId: 0, stakeCredential: keyHash })
    const mislabeled = bech32.encode("stake", bech32.toWords(RewardAccount.toBytes(testnet)), false)
    expect(() => RewardAccount.fromBech32(mislabeled)).toThrow(/does not match network 0/)
    // Mainnet reward payload encoded under "stake_test"
    const mainnet = new RewardAccount.RewardAccount({ networkId: 1, stakeCredential: keyHash })
    const mislabeledTest = bech32.encode("stake_test", bech32.toWords(RewardAccount.toBytes(mainnet)), false)
    expect(() => RewardAccount.fromBech32(mislabeledTest)).toThrow(/does not match network 1/)
  })

  it("still parses valid stake and stake_test round-trips (key credential)", () => {
    const mainnet = new RewardAccount.RewardAccount({ networkId: 1, stakeCredential: keyHash })
    // sanity: 0xe1 = type 14 (reward, stake-key), mainnet
    expect(RewardAccount.toHex(mainnet).slice(0, 2)).toBe("e1")
    expect(RewardAccount.fromHex(RewardAccount.toHex(mainnet)).stakeCredential._tag).toBe("KeyHash")
    const mainnetBech32 = RewardAccount.toBech32(mainnet)
    expect(mainnetBech32.startsWith("stake1")).toBe(true)
    expect(RewardAccount.fromBech32(mainnetBech32).networkId).toBe(1)

    const testnet = new RewardAccount.RewardAccount({ networkId: 0, stakeCredential: keyHash })
    expect(RewardAccount.toHex(testnet).slice(0, 2)).toBe("e0")
    const testnetBech32 = RewardAccount.toBech32(testnet)
    expect(testnetBech32.startsWith("stake_test1")).toBe(true)
    expect(RewardAccount.fromBech32(testnetBech32).networkId).toBe(0)
  })

  it("still parses a valid script-credential reward account (type 15)", () => {
    const scriptHash = new ScriptHash.ScriptHash({ hash: keyHash.hash })
    const reward = new RewardAccount.RewardAccount({ networkId: 1, stakeCredential: scriptHash })
    // sanity: 0xf1 = type 15 (reward, script), mainnet
    expect(RewardAccount.toHex(reward).slice(0, 2)).toBe("f1")
    const parsed = RewardAccount.fromHex(RewardAccount.toHex(reward))
    expect(parsed.stakeCredential._tag).toBe("ScriptHash")
    expect(RewardAccount.fromBech32(RewardAccount.toBech32(reward)).stakeCredential._tag).toBe("ScriptHash")
  })
})
