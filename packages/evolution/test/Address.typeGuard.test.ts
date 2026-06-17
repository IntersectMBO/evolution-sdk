/**
 * Tests for `instanceof Address` type-guard correctness.
 *
 * Provider implementations (BlockfrostEffect, KupmiosEffects, KoiosEffect,
 * MaestroEffect, Wallets) all use `addressOrCredential instanceof Address` to
 * discriminate the `Address | Credential` union at runtime.
 *
 * `Address` uses `Schema.Class` (not `Schema.TaggedClass`) so there is no `_tag`
 * field — `instanceof` is the only correct runtime discriminator for this type.
 */

import { describe, expect, it } from "@effect/vitest"
import { FastCheck } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as Credential from "../src/Credential.js"

const MAINNET_BASE_ADDRESS =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x"
const MAINNET_ENTERPRISE_ADDRESS = "addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8"
const TESTNET_BASE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const DUMMY_HASH = new Uint8Array(28).fill(0xab)

describe("Address instanceof type-guard", () => {
  describe("Address instances pass instanceof Address", () => {
    it("fromBech32 base address", () => {
      const addr = CoreAddress.fromBech32(MAINNET_BASE_ADDRESS)
      expect(addr instanceof CoreAddress.Address).toBe(true)
    })

    it("fromBech32 enterprise address", () => {
      const addr = CoreAddress.fromBech32(MAINNET_ENTERPRISE_ADDRESS)
      expect(addr instanceof CoreAddress.Address).toBe(true)
    })

    it("fromBech32 testnet address", () => {
      const addr = CoreAddress.fromBech32(TESTNET_BASE_ADDRESS)
      expect(addr instanceof CoreAddress.Address).toBe(true)
    })

    it("fromHex round-trip", () => {
      const addr = CoreAddress.fromBech32(MAINNET_BASE_ADDRESS)
      const addrFromHex = CoreAddress.fromHex(CoreAddress.toHex(addr))
      expect(addrFromHex instanceof CoreAddress.Address).toBe(true)
    })

    it("fromBytes round-trip", () => {
      const addr = CoreAddress.fromBech32(MAINNET_BASE_ADDRESS)
      const addrFromBytes = CoreAddress.fromBytes(CoreAddress.toBytes(addr))
      expect(addrFromBytes instanceof CoreAddress.Address).toBe(true)
    })

    it("Address.make (arbitrary)", () => {
      FastCheck.assert(
        FastCheck.property(CoreAddress.arbitrary, (addr) => {
          expect(addr instanceof CoreAddress.Address).toBe(true)
        })
      )
    })
  })

  describe("Credential instances fail instanceof Address", () => {
    it("KeyHash is not instanceof Address", () => {
      const kh = Credential.makeKeyHash(DUMMY_HASH)
      expect(kh instanceof CoreAddress.Address).toBe(false)
    })

    it("ScriptHash is not instanceof Address", () => {
      const sh = Credential.makeScriptHash(DUMMY_HASH)
      expect(sh instanceof CoreAddress.Address).toBe(false)
    })

    it("arbitrary Credentials are not instanceof Address", () => {
      FastCheck.assert(
        FastCheck.property(Credential.arbitrary, (cred) => {
          expect(cred instanceof CoreAddress.Address).toBe(false)
        })
      )
    })
  })

  describe("Plain objects fail instanceof Address", () => {
    it("plain object shaped like Address is not instanceof Address", () => {
      const addr = CoreAddress.fromBech32(MAINNET_BASE_ADDRESS)
      const plain = {
        networkId: addr.networkId,
        paymentCredential: addr.paymentCredential,
        stakingCredential: addr.stakingCredential
      }
      expect(plain instanceof CoreAddress.Address).toBe(false)
    })

    it("null is not instanceof Address", () => {
      expect((null as unknown) instanceof CoreAddress.Address).toBe(false)
    })

    it("undefined is not instanceof Address", () => {
      expect(
        (() => {
          try {
            return (undefined as unknown) instanceof CoreAddress.Address
          } catch {
            return false
          }
        })()
      ).toBe(false)
    })
  })

  describe("duck-typing discriminator — cross-version safe", () => {
    /**
     * `KupmiosEffects.getUtxosWithUnitEffect` uses `!('hash' in x)` instead of
     * `instanceof Address` to discriminate the `Address | Credential` union.
     *
     * This is robust against cross-version module identity issues: when the
     * caller's Address was constructed by a different copy of the module (e.g.
     * v0.5.4 vs v0.5.2 due to package manager hoisting), `instanceof` returns
     * false even for a valid Address, causing the credential branch to execute
     * and producing a malformed Kupo URL (HTTP 400).
     *
     * Duck-typing is reliable because:
     *   • Credential (KeyHash | ScriptHash) always has `.hash: Uint8Array`
     *   • Address has `networkId`, `paymentCredential`, `stakingCredential` — no `.hash`
     */

    const isAddressDuckType = (x: object) => !("hash" in x)

    it("cross-version: plain object mimicking Address structure (no .hash) → isAddress = true", () => {
      // Simulate cross-version scenario: plain object mimicking Address structure (no .hash)
      const fakeAddress = { header: new Uint8Array([0x71]), body: new Uint8Array(28) }
      // Should be treated as address (isAddress = true), not fall to .hash branch
      expect(isAddressDuckType(fakeAddress)).toBe(true)
    })

    it("real Address instance → isAddress = true", () => {
      const addr = CoreAddress.fromBech32(MAINNET_BASE_ADDRESS)
      expect(isAddressDuckType(addr)).toBe(true)
    })

    it("KeyHash (Credential) → isAddress = false", () => {
      const kh = Credential.makeKeyHash(DUMMY_HASH)
      expect(isAddressDuckType(kh)).toBe(false)
    })

    it("ScriptHash (Credential) → isAddress = false", () => {
      const sh = Credential.makeScriptHash(DUMMY_HASH)
      expect(isAddressDuckType(sh)).toBe(false)
    })

    it("property: every real Address passes duck-type as address", () => {
      FastCheck.assert(
        FastCheck.property(CoreAddress.arbitrary, (addr) => {
          expect(isAddressDuckType(addr)).toBe(true)
        })
      )
    })

    it("property: every Credential fails duck-type as address", () => {
      FastCheck.assert(
        FastCheck.property(Credential.arbitrary, (cred) => {
          expect(isAddressDuckType(cred)).toBe(false)
        })
      )
    })
  })

  describe("instanceof correctly discriminates Address | Credential union", () => {
    const classify = (v: CoreAddress.Address | Credential.Credential): "address" | "credential" =>
      v instanceof CoreAddress.Address ? "address" : "credential"

    it("Address → 'address' branch", () => {
      expect(classify(CoreAddress.fromBech32(MAINNET_BASE_ADDRESS))).toBe("address")
    })

    it("Address enterprise → 'address' branch", () => {
      expect(classify(CoreAddress.fromBech32(MAINNET_ENTERPRISE_ADDRESS))).toBe("address")
    })

    it("KeyHash → 'credential' branch", () => {
      expect(classify(Credential.makeKeyHash(DUMMY_HASH))).toBe("credential")
    })

    it("ScriptHash → 'credential' branch", () => {
      expect(classify(Credential.makeScriptHash(new Uint8Array(28).fill(0xcd)))).toBe("credential")
    })

    it("property: every Address routes to 'address'", () => {
      FastCheck.assert(
        FastCheck.property(CoreAddress.arbitrary, (addr) => {
          expect(classify(addr)).toBe("address")
        })
      )
    })

    it("property: every Credential routes to 'credential'", () => {
      FastCheck.assert(
        FastCheck.property(Credential.arbitrary, (cred) => {
          expect(classify(cred)).toBe("credential")
        })
      )
    })
  })
})
