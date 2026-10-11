/**
 * The CIP-2 core, ported with its suite from the wallet-side package it was written in.
 * `CoinSelection.test.ts` covers the public surface over `UTxO` and `Assets`.
 */
import { describe, expect, it } from "vitest"

import * as Cip2 from "../src/sdk/builders/internal/Cip2.js"

const ada = (coin: bigint): Cip2.SelValue => ({ coin, assets: new Map() })
const withAsset = (coin: bigint, id: string, qty: bigint): Cip2.SelValue => ({
  coin,
  assets: new Map([[id, qty]])
})

/** UTxOs keyed by a plain string outpoint, exercising the `Id` parameter. */
const utxos = (...coins: Array<bigint>): Array<Cip2.SelUtxo<string>> =>
  coins.map((c, i) => ({ id: `utxo-${i}`, value: ada(c) }))

const total = (r: Cip2.SelectResult<string>): bigint => r.inputTotal.coin

describe("largest-first", () => {
  it("takes the largest UTxOs until the target is covered", () => {
    const r = Cip2.selectCoins(utxos(1n, 50n, 10n, 5n), ada(55n), "largest-first")
    expect(r.selected.map((u) => u.id)).toEqual(["utxo-1", "utxo-2"])
    expect(total(r)).toBe(60n)
  })

  it("stops as soon as it is covered", () => {
    const r = Cip2.selectCoins(utxos(100n, 50n, 10n), ada(60n), "largest-first")
    expect(r.selected).toHaveLength(1)
    expect(total(r)).toBe(100n)
  })

  it("is deterministic and needs no RNG", () => {
    const set = utxos(7n, 3n, 9n, 1n)
    const a = Cip2.selectCoins(set, ada(10n), "largest-first")
    const b = Cip2.selectCoins(set, ada(10n), "largest-first")
    expect(a.selected.map((u) => u.id)).toEqual(b.selected.map((u) => u.id))
  })

  it("fails when the balance cannot cover the target", () => {
    expect(() => Cip2.selectCoins(utxos(1n, 2n), ada(10n), "largest-first")).toThrow(Cip2.Cip2Error)
  })

  it("refuses a multiasset target without a multiasset strategy", () => {
    expect(() => Cip2.selectCoins(utxos(100n), withAsset(10n, "aa", 1n), "largest-first")).toThrow(
      /multiasset strategy/
    )
  })
})

describe("random-improve", () => {
  it("covers the target and is reproducible under a seed", () => {
    const set = utxos(10n, 20n, 30n, 40n, 50n)
    const a = Cip2.selectCoins(set, ada(45n), "random-improve", { seed: 42 })
    const b = Cip2.selectCoins(set, ada(45n), "random-improve", { seed: 42 })
    expect(a.selected.map((u) => u.id)).toEqual(b.selected.map((u) => u.id))
    expect(total(a)).toBeGreaterThanOrEqual(45n)
  })

  it("always ends up covering the target across many seeds", () => {
    const set = utxos(1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n)
    for (let seed = 0; seed < 200; seed++) {
      const r = Cip2.selectCoins(set, ada(40n), "random-improve", { seed })
      expect(total(r)).toBeGreaterThanOrEqual(40n)
    }
  })

  it("never returns a duplicate input", () => {
    const set = utxos(5n, 5n, 5n, 5n, 5n, 5n)
    for (let seed = 0; seed < 100; seed++) {
      const r = Cip2.selectCoins(set, ada(20n), "random-improve", { seed })
      const ids = r.selected.map((u) => u.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it("reports the total of exactly the inputs it returns", () => {
    const set = utxos(3n, 11n, 17n, 29n, 41n)
    for (let seed = 0; seed < 100; seed++) {
      const r = Cip2.selectCoins(set, ada(50n), "random-improve", { seed })
      const summed = r.selected.reduce((acc, u) => acc + u.value.coin, 0n)
      expect(summed).toBe(total(r))
    }
  })

  it("accepts a caller-supplied rng instead of a seed", () => {
    let calls = 0
    const rng = () => {
      calls++
      return 0
    }
    const r = Cip2.selectCoins(utxos(10n, 20n, 30n), ada(25n), "random-improve", { rng })
    expect(calls).toBeGreaterThan(0)
    expect(total(r)).toBeGreaterThanOrEqual(25n)
  })
})

describe("multiasset", () => {
  const id = "policy01" + "746f6b656e"
  const set: Array<Cip2.SelUtxo<string>> = [
    { id: "a", value: ada(5n) },
    { id: "b", value: withAsset(2n, id, 7n) },
    { id: "c", value: ada(50n) },
    { id: "d", value: withAsset(1n, id, 3n) }
  ]

  it("largest-first covers both the asset and the coin", () => {
    const r = Cip2.selectCoins(set, withAsset(10n, id, 9n), "largest-first-multiasset")
    expect(r.inputTotal.assets.get(id)!).toBeGreaterThanOrEqual(9n)
    expect(r.inputTotal.coin).toBeGreaterThanOrEqual(10n)
  })

  it("random-improve covers both, including the fee top-up pass", () => {
    for (let seed = 0; seed < 50; seed++) {
      const r = Cip2.selectCoins(set, withAsset(40n, id, 5n), "random-improve-multiasset", {
        seed
      })
      expect(r.inputTotal.assets.get(id)!).toBeGreaterThanOrEqual(5n)
      expect(r.inputTotal.coin).toBeGreaterThanOrEqual(40n)
    }
  })

  it("fails when the asset is not available in quantity", () => {
    expect(() => Cip2.selectCoins(set, withAsset(1n, id, 100n), "largest-first-multiasset")).toThrow(Cip2.Cip2Error)
  })
})

describe("value helpers", () => {
  it("emptyValue defaults to zero and carries no assets", () => {
    expect(Cip2.emptyValue()).toEqual({ coin: 0n, assets: new Map() })
    expect(Cip2.emptyValue(5n).coin).toBe(5n)
  })

  it("mulberry32 is a pure function of its seed", () => {
    const a = Cip2.mulberry32(7)
    const b = Cip2.mulberry32(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
