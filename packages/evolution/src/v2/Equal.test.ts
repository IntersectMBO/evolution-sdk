import { describe, expect, it } from "@effect/vitest"
import { Equal as EffectEqual } from "effect"

import * as TxHash from "../TransactionHash.js"
import * as Equal from "./Equal.js"

describe("Equal", () => {
  it("Uint8Array content comparison", () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3])
    const c = new Uint8Array([1, 2, 4])

    expect(Equal.equals(a, b)).toBe(true)
    expect(Equal.equals(a, c)).toBe(false)

    // Effect's Equal would fail here
    expect(EffectEqual.equals(a, b)).toBe(false)
  })

  it("Uint8Array curried form", () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3])

    const equalsB = Equal.equals(b)
    expect(equalsB(a)).toBe(true)
  })

  it("empty Uint8Arrays", () => {
    expect(Equal.equals(new Uint8Array([]), new Uint8Array([]))).toBe(true)
  })

  it("different length Uint8Arrays", () => {
    expect(Equal.equals(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false)
  })

  it("same reference", () => {
    const a = new Uint8Array([1, 2])
    expect(Equal.equals(a, a)).toBe(true)
  })

  it("delegates to Effect Equal for domain types", () => {
    const a = new TxHash.TransactionHash({ hash: new Uint8Array(32).fill(0xab) })
    const b = new TxHash.TransactionHash({ hash: new Uint8Array(32).fill(0xab) })
    const c = new TxHash.TransactionHash({ hash: new Uint8Array(32).fill(0xcd) })

    expect(Equal.equals(a, b)).toBe(true)
    expect(Equal.equals(a, c)).toBe(false)
  })

  it("delegates to Effect Equal for primitives", () => {
    expect(Equal.equals(42, 42)).toBe(true)
    expect(Equal.equals(42, 43)).toBe(false)
    expect(Equal.equals("abc", "abc")).toBe(true)
    expect(Equal.equals(true, true)).toBe(true)
  })

  it("mixed types", () => {
    expect(Equal.equals(new Uint8Array([1]), 1 as any)).toBe(false)
    expect(Equal.equals(new Uint8Array([1]), "1" as any)).toBe(false)
  })
})
