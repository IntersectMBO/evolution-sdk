import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as Assets from "../src/Assets.js"
import * as MinAda from "../src/MinAda.js"
import * as TxOut from "../src/TxOut.js"

/**
 * Minimum lovelace was computed inside `sdk/builders/internal/txBuilder`, where a wallet
 * balancing a transaction outside the builder could not reach it. Reimplementing it is the only
 * alternative, and an under-estimate produces outputs a node rejects.
 */
describe("MinAda.forOutput", () => {
  const ADDRESS = "010fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42e557890352095f1cf6fd2b7d1a28e3c3cb029f48cf34ff890a28d176"
  const COINS_PER_UTXO_BYTE = 4310n
  const out = (assets: Assets.Assets) =>
    new TxOut.TransactionOutput({ address: Address.fromHex(ADDRESS), assets })

  it("is a true fixed point: feeding the answer back changes nothing", () => {
    const base = out(Assets.fromLovelace(0n))
    const min = MinAda.forOutput(base, COINS_PER_UTXO_BYTE)
    const funded = out(Assets.fromLovelace(min))
    expect(MinAda.forOutput(funded, COINS_PER_UTXO_BYTE)).toBe(min)
  })

  it("is the size rule: (160 + serialized bytes) * coinsPerUtxoByte", () => {
    const min = MinAda.forOutput(out(Assets.fromLovelace(0n)), COINS_PER_UTXO_BYTE)
    const atMin = out(Assets.fromLovelace(min))
    const size = BigInt(TxOut.toCBORBytes(atMin).length)
    expect(min).toBe(COINS_PER_UTXO_BYTE * (MinAda.UTXO_ENTRY_OVERHEAD_BYTES + size))
  })

  it("rises when the output carries a token, because the output is bigger", () => {
    const bare = MinAda.forOutput(out(Assets.fromLovelace(0n)), COINS_PER_UTXO_BYTE)
    const withToken = MinAda.forOutput(
      out(Assets.fromHexStrings("07".repeat(28), Buffer.from("token").toString("hex"), 1n)),
      COINS_PER_UTXO_BYTE
    )
    expect(withToken).toBeGreaterThan(bare)
  })

  it("scales with coinsPerUtxoByte", () => {
    const base = out(Assets.fromLovelace(0n))
    expect(MinAda.forOutput(base, 8620n)).toBeGreaterThan(MinAda.forOutput(base, 4310n))
  })

  it("⚠️ depends on the output's encoding format, because that changes its size", () => {
    const shelley = MinAda.forOutput(out(Assets.fromLovelace(0n)), COINS_PER_UTXO_BYTE)
    const babbage = MinAda.forOutput(
      new TxOut.TransactionOutput({
        address: Address.fromHex(ADDRESS),
        assets: Assets.fromLovelace(0n),
        encodingFormat: "babbage"
      }),
      COINS_PER_UTXO_BYTE
    )
    expect(babbage).toBeGreaterThan(shelley)
  })
})
