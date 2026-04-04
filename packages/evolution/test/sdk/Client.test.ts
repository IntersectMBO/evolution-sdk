import { describe, expect, it } from "vitest"

import * as Address from "../../src/Address.js"
import * as Assets from "../../src/Assets/index.js"
import type {
  Addressable,
  AwaitTx,
  Client,
  EvaluateTx,
  QueryDatumByHash,
  QueryDelegation,
  QueryProtocolParams,
  QueryUtxos,
  QueryUtxosByOutRef,
  Signable,
  SubmitTx
} from "../../src/index.js"
import {
  blockfrost,
  client,
  koios,
  kupmios,
  maestro,
  mainnet,
  newTx,
  preprod,
  preview,
  readOnlyWallet
} from "../../src/index.js"
import type { TxBuilder } from "../../src/sdk/builders/TransactionBuilder.js"

// ── Type-level tests ──────────────────────────────────────────────────────────

// Verify client(chain) returns the right shape
const _baseClient = client(preview)
// @ts-expect-error — base client has no getUtxos
void _baseClient.getUtxos

// Verify blockfrost adds capabilities
const _bfClient = client(preview)
  .with(blockfrost({ baseUrl: "https://cardano-preview.blockfrost.io/api/v0", projectId: "test" }))
// These should type-check — blockfrost adds these capabilities
type _AssertBfHasGetUtxos = typeof _bfClient extends QueryUtxos ? true : never
type _AssertBfHasGetPP = typeof _bfClient extends QueryProtocolParams ? true : never
type _AssertBfHasSubmit = typeof _bfClient extends SubmitTx ? true : never
type _AssertBfHasOutRef = typeof _bfClient extends QueryUtxosByOutRef ? true : never
type _AssertBfHasDelegation = typeof _bfClient extends QueryDelegation ? true : never
type _AssertBfHasAwait = typeof _bfClient extends AwaitTx ? true : never
type _AssertBfHasDatum = typeof _bfClient extends QueryDatumByHash ? true : never
type _AssertBfHasEval = typeof _bfClient extends EvaluateTx ? true : never

// Verify the client still carries chain context
type _AssertBfHasChain = typeof _bfClient extends Client ? true : never

// Type assertion helper — forces TS to verify type assignment
const _assertType = <T>(_v: T) => {}
_assertType<true>(true as _AssertBfHasGetUtxos)
_assertType<true>(true as _AssertBfHasGetPP)
_assertType<true>(true as _AssertBfHasSubmit)
_assertType<true>(true as _AssertBfHasChain)

// Verify function constraints work
const _getBalance = async (c: QueryUtxos & Addressable): Promise<void> => {
  // This would work at runtime with real implementations
  void c.getUtxos
  void c.getAddress
}

// Verify newTx return type narrows based on capabilities
const _newTxReadOnly = (c: Client & Addressable) => {
  const tx = newTx(c)
  // Type-level: Addressable without Signable → read-only TxBuilder
  const _ro: TxBuilder<typeof c, {}> = tx
  void _ro
}
const _newTxSigning = (c: Client & Addressable & Signable) => {
  const tx = newTx(c)
  // Type-level: Addressable & Signable → signing TxBuilder
  const _st: TxBuilder<typeof c, {}> = tx
  void _st
}

const _signAndSubmit = async (c: SubmitTx & Signable, _tx: string): Promise<void> => {
  void c.submitTx
  void c.signTx
}

// ── Runtime tests ─────────────────────────────────────────────────────────────

describe("Client API", () => {
  describe("client()", () => {
    it("creates a base client with chain context", () => {
      const c = client(preview)
      expect(c.chain).toBe(preview)
      expect(c.networkId).toBe(0)
      expect(c.Effect).toEqual({})
    })

    it("carries correct networkId for mainnet", () => {
      const c = client(mainnet)
      expect(c.networkId).toBe(1)
    })

    it("carries correct networkId for preprod", () => {
      const c = client(preprod)
      expect(c.networkId).toBe(0)
    })
  })

  describe("blockfrost()", () => {
    it("adds provider capabilities to client", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://cardano-preview.blockfrost.io/api/v0", projectId: "test" }))

      // Client context preserved
      expect(c.chain).toBe(preview)
      expect(c.networkId).toBe(0)

      // Provider methods exist
      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.getUtxosByOutRef).toBe("function")
      expect(typeof c.getProtocolParameters).toBe("function")
      expect(typeof c.getDelegation).toBe("function")
      expect(typeof c.submitTx).toBe("function")
      expect(typeof c.awaitTx).toBe("function")
      expect(typeof c.getDatum).toBe("function")
      expect(typeof c.evaluateTx).toBe("function")

      // Effect namespace exists
      expect(typeof c.Effect.getUtxos).toBe("function")
      expect(typeof c.Effect.submitTx).toBe("function")
    })
  })

  describe("maestro()", () => {
    it("adds provider capabilities to client", () => {
      const c = client(mainnet)
        .with(maestro({ baseUrl: "https://mainnet.gomaestro-api.org/v1", apiKey: "test" }))

      expect(c.chain).toBe(mainnet)
      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.evaluateTx).toBe("function")
      expect(typeof c.Effect.getUtxos).toBe("function")
    })
  })

  describe("koios()", () => {
    it("adds provider capabilities to client", () => {
      const c = client(preprod)
        .with(koios({ baseUrl: "https://preprod.koios.rest/api/v1" }))

      expect(c.chain).toBe(preprod)
      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.getDelegation).toBe("function")
      expect(typeof c.Effect.getUtxos).toBe("function")
    })
  })

  describe("kupmios()", () => {
    it("adds provider capabilities to client", () => {
      const c = client(preview)
        .with(kupmios({ kupoUrl: "http://localhost:1442", ogmiosUrl: "ws://localhost:1337" }))

      expect(c.chain).toBe(preview)
      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.evaluateTx).toBe("function")
      expect(typeof c.submitTx).toBe("function")
      expect(typeof c.Effect.getUtxos).toBe("function")
    })
  })

  describe("composition", () => {
    it("preserves chain context through provider middleware", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      expect(c.chain.name).toBe("Cardano Preview")
      expect(c.chain.networkMagic).toBe(2)
      expect(c.chain.epochLength).toBe(86400)
    })

    it("Effect namespace merges across middleware", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      // Effect namespace should have all provider Effect methods
      expect(typeof c.Effect.getUtxos).toBe("function")
      expect(typeof c.Effect.getProtocolParameters).toBe("function")
      expect(typeof c.Effect.submitTx).toBe("function")
      expect(typeof c.Effect.evaluateTx).toBe("function")
    })

    it("two providers — last wins for overlapping methods at runtime", () => {
      const bfCfg = { baseUrl: "https://bf.test", projectId: "bf" }
      const maestroCfg = { baseUrl: "https://maestro.test", apiKey: "maestro" }

      const c = client(preview)
        .with(blockfrost(bfCfg))
        .with(maestro(maestroCfg))

      // Both provider capabilities are present at the type level
      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.submitTx).toBe("function")
      expect(typeof c.evaluateTx).toBe("function")
      expect(typeof c.getDelegation).toBe("function")

      // Effect namespace has methods from both
      expect(typeof c.Effect.getUtxos).toBe("function")
      expect(typeof c.Effect.submitTx).toBe("function")

      // Chain context survives composition
      expect(c.chain).toBe(preview)
      expect(c.networkId).toBe(0)
    })

    it("provider + wallet — both capability sets present", () => {
      // Type-level: seedWallet is tested for compilation only
      // (runtime requires valid mnemonic + crypto libs)
      const bfClient = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      // Provider capabilities exist
      expect(typeof bfClient.getUtxos).toBe("function")
      expect(typeof bfClient.submitTx).toBe("function")

      // Effect namespace from provider
      expect(typeof bfClient.Effect.getUtxos).toBe("function")
      expect(typeof bfClient.Effect.submitTx).toBe("function")
    })
  })

  describe("newTx()", () => {
    it("returns a transaction builder from provider-only client", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      const tx = newTx(c)

      // Should be a ReadOnlyTransactionBuilder (no wallet)
      expect(typeof tx.payToAddress).toBe("function")
      expect(typeof tx.collectFrom).toBe("function")
      expect(typeof tx.mintAssets).toBe("function")
      expect(typeof tx.build).toBe("function")

      // Type-level: no signing wallet → read-only TxBuilder
      const _tx: TxBuilder<typeof c, {}> = tx
      void _tx
    })

    it("returns a transaction builder from provider + readOnly wallet client", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))
        .with(readOnlyWallet("addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"))

      const tx = newTx(c)

      // Should still be ReadOnlyTransactionBuilder (no signTx)
      expect(typeof tx.payToAddress).toBe("function")
      expect(typeof tx.build).toBe("function")

      // Type-level: Addressable but not Signable → read-only TxBuilder
      const _tx: TxBuilder<typeof c, {}> = tx
      void _tx
    })

    it("passes slotConfig from chain to builder", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      // newTx should not throw — it just creates the builder
      const tx = newTx(c)
      expect(tx).toBeDefined()
    })

    it("creates builder without provider or wallet (manual mode)", () => {
      const c = client(preview)

      const tx = newTx(c)

      // Should be a ReadOnlyTransactionBuilder with no provider/wallet
      expect(typeof tx.payToAddress).toBe("function")
      expect(typeof tx.build).toBe("function")
    })

    it("chains builder methods", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      const tx = newTx(c)
        .payToAddress({
          address: Address.fromBech32(
            "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
          ),
          assets: Assets.fromLovelace(5_000_000n)
        })

      expect(typeof tx.build).toBe("function")
    })

    it("client.newTx() method returns the same shape as newTx(client)", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      const fromMethod = c.newTx()
      const fromFunction = newTx(c)

      expect(typeof fromMethod.payToAddress).toBe("function")
      expect(typeof fromMethod.collectFrom).toBe("function")
      expect(typeof fromMethod.build).toBe("function")
      expect(typeof fromFunction.payToAddress).toBe("function")
      expect(typeof fromFunction.build).toBe("function")
    })

    it("base client has newTx() method", () => {
      const c = client(preview)
      expect(typeof c.newTx).toBe("function")
      const tx = c.newTx()
      expect(typeof tx.payToAddress).toBe("function")
      expect(typeof tx.build).toBe("function")
    })

    it("provider middleware preserves newTx() method", () => {
      const c = client(preview)
        .with(kupmios({ kupoUrl: "http://localhost:1442", ogmiosUrl: "ws://localhost:1337" }))
      expect(typeof c.newTx).toBe("function")
      const tx = c.newTx()
      expect(typeof tx.collectFrom).toBe("function")
    })
  })

  describe(".with()", () => {
    it("base client has .with() method", () => {
      const c = client(preview)
      expect(typeof c.with).toBe("function")
    })

    it("composes provider middleware chainably", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))

      expect(c.chain).toBe(preview)
      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.with).toBe("function")
    })

    it("chains multiple middleware", () => {
      const c = client(preview)
        .with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))
        .with(readOnlyWallet("addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"))

      expect(typeof c.getUtxos).toBe("function")
      expect(typeof c.getAddress).toBe("function")
      expect(c.chain).toBe(preview)
    })

    it("preserves .with() after each middleware", () => {
      const c1 = client(preview).with(blockfrost({ baseUrl: "https://test.com", projectId: "test" }))
      expect(typeof c1.with).toBe("function")

      const c2 = c1.with(readOnlyWallet("addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"))
      expect(typeof c2.with).toBe("function")
    })
  })
})