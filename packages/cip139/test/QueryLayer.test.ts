import {
  Address,
  Assets,
  CBOR,
  Data,
  InlineDatum,
  OriginalBytes,
  type Provider,
  RewardAddress,
  TransactionHash,
  UTxO as CoreUTxO
} from "@evolution-sdk/evolution"
import { Provider as ProviderModule } from "@evolution-sdk/evolution"
import { Koios } from "@evolution-sdk/evolution/sdk/provider/Koios"
import { MockProvider } from "@evolution-sdk/evolution/sdk/provider/Mock"
import { Decode } from "@evolution-sdk/review"
import { Effect, Either, Layer } from "effect"
import { describe, expect, it } from "vitest"

import * as QueryLayer from "../src/QueryLayer.js"
import * as Types from "../src/Types.js"

const ADDR =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"
const STAKE = RewardAddress.RewardAddress.make("stake_test1uqevw2xnsc2pvm53ps48jtgluzw7udqkd2jet7k5gqz2kzs2vlv9q")
// Three stand-in reward addresses, one per branch of `getDrepByStakeCredential`: delegated to a
// predefined target, registered but undelegated, and absent from the provider entirely. They are
// map keys the mock never decodes, so they are deliberately unmistakable rather than plausible.
const STAKE_ABSTAIN = RewardAddress.RewardAddress.make("stake_test1abstain")
const STAKE_UNDELEGATED = RewardAddress.RewardAddress.make("stake_test1undelegated")
const STAKE_UNKNOWN = RewardAddress.RewardAddress.make("stake_test1neverseen")
const TX = "ab".repeat(32)
/** `Constr 1 []` indefinite-framed; the encoder writes an empty array definite whatever it parsed. */
const REFRAMING_DATUM = "d87a9fff"

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"))

const utxo = (index: number, datumHex?: string) =>
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex(TX),
    index: BigInt(index),
    address: Address.fromBech32(ADDR),
    assets: Assets.fromLovelace(2_000_000n),
    ...(datumHex !== undefined
      ? {
        datumOption: OriginalBytes.record(
          new InlineDatum.InlineDatum({ data: Data.fromCBORHex(datumHex) }),
          hexBytes(datumHex)
        )
      }
      : {})
  })

const run = <A, E>(eff: Effect.Effect<A, E, ProviderModule.ProviderEffect | Decode.Decode>, provider: MockProvider) =>
  Effect.runPromise(
    Effect.either(eff).pipe(
      Effect.provide(Layer.merge(Layer.succeed(ProviderModule.ProviderEffect, provider.effect), Decode.layer))
    )
  )

const ok = async <A, E>(
  eff: Effect.Effect<A, E, ProviderModule.ProviderEffect | Decode.Decode>,
  provider: MockProvider
): Promise<A> => {
  const r = await run(eff, provider)
  if (Either.isLeft(r)) throw new Error(`expected success, got ${JSON.stringify(r.left)}`)
  return r.right
}

const layer = QueryLayer.makeQueryLayer()

describe("capability probing", () => {
  // A wallet advertising `{cip: 139}` tells a dApp it can stop bringing its own query layer.
  // A provider that cannot answer must produce a failure naming BOTH the operation and the
  // member it wanted, not an empty list that reads like "the chain has none".
  const bare = new MockProvider({ utxos: [utxo(0)] })

  it("names both sides when the provider cannot answer", async () => {
    const r = await run(layer.getAllPools(), bare)
    expect(Either.isLeft(r) && (r.left as ProviderModule.ProviderError).message).toMatch(
      /getAllPools requires ProviderEffect\.getPools/
    )
    const v = await run(layer.getVotesByDrepId("drep1x"), bare)
    expect(Either.isLeft(v) && (v.left as ProviderModule.ProviderError).message).toMatch(
      /getVotesByDrepId requires ProviderEffect\.getVotesByDRep/
    )
  })

  it("a bare provider does not support the extension", () => {
    expect(QueryLayer.supportsQueryLayer(bare.effect)).toBe(false)
  })

  it("one missing member is enough to withhold the claim", () => {
    const full = Object.fromEntries(
      QueryLayer.QUERY_LAYER_MEMBERS.map((m) => [m, () => Effect.succeed([])])
    ) as unknown as ProviderModule.ProviderEffect
    expect(QueryLayer.supportsQueryLayer(full)).toBe(true)
    for (const omit of QueryLayer.QUERY_LAYER_MEMBERS) {
      const partial = Object.fromEntries(
        QueryLayer.QUERY_LAYER_MEMBERS.filter((m) => m !== omit).map((m) => [m, () => Effect.succeed([])])
      ) as unknown as ProviderModule.ProviderEffect
      expect(QueryLayer.supportsQueryLayer(partial)).toBe(false)
    }
  })

  it("the Koios provider supports it end to end", () => {
    expect(QueryLayer.supportsQueryLayer(new Koios("https://preprod.koios.rest/api/v1").effect)).toBe(true)
  })
})

describe("enum translation", () => {
  // Every one of these would otherwise emit JSON that violates the CIP's enum while looking
  // entirely reasonable -- the failure mode a consumer discovers last.
  it("lowercases votes", () => {
    const v = (vote: string) => QueryLayer.voteInfo({ proposalId: "g1", voteTxHash: TX, vote }).vote
    expect([v("Yes"), v("No"), v("Abstain")]).toEqual(["yes", "no", "abstain"])
  })

  it("crosses the US/British spelling boundary on committee status", () => {
    const s = (status: string) => QueryLayer.committeeMember({ coldId: "c", hotId: "h", status }).status
    expect([s("authorized"), s("not_authorized"), s("resigned")]).toEqual([
      "authorised",
      "not_authorised",
      "resigned"
    ])
  })

  it("maps `registered` onto `active`, a member the backend's vocabulary does not have", () => {
    const p = (status: string) =>
      QueryLayer.pool({ poolId: "pool1x", status, activeStake: 1n, liveStake: 2n }).status
    expect([p("registered"), p("retiring"), p("retired")]).toEqual(["active", "retiring", "retired"])
  })

  it("refuses an unknown value instead of leaking it through", () => {
    expect(() => QueryLayer.voteInfo({ proposalId: "g", voteTxHash: TX, vote: "yes" })).toThrow(/unknown vote value/)
    expect(() => QueryLayer.committeeMember({ coldId: "c", hotId: "h", status: "authorised" })).toThrow(
      /unknown committee status/
    )
    expect(() => QueryLayer.pool({ poolId: "p", status: "active", activeStake: 1n, liveStake: 1n })).toThrow(
      /unknown pool status/
    )
  })

  it("refuses a pool whose live stake was never reported", () => {
    expect(() => QueryLayer.pool({ poolId: "pool1x", status: "registered", activeStake: 1n })).toThrow(
      /live_stake is required/
    )
  })

  it("emits \"0\" for a DRep with no delegated stake, despite PosInt64 excluding it", () => {
    expect(QueryLayer.drepInfo({ drepId: "drep1x", active: true, amount: 0n }).amount).toBe("0")
  })

  it("leaves a pending proposal's epochs absent rather than zero", () => {
    expect(QueryLayer.proposal({ proposalId: "g1" })).toEqual({ proposal_id: "g1" })
    expect(QueryLayer.proposal({ proposalId: "g1", enactedEpoch: 0 })).toEqual({
      proposal_id: "g1",
      enacted_epoch: 0
    })
  })
})

describe("getUtxosByAddress", () => {
  const provider = new MockProvider({ utxos: [utxo(0), utxo(1, REFRAMING_DATUM)] })

  it("emits CIP-116 unspent outputs", async () => {
    const utxos = await ok(layer.getUtxosByAddress(Address.fromBech32(ADDR)), provider)
    expect(utxos).toHaveLength(2)
    expect(utxos[0]!.input).toEqual({ transaction_id: TX, index: 0 })
    expect(utxos[0]!.output.address).toBe(ADDR)
    expect(utxos[0]!.output.amount).toEqual({ coin: "2000000" })
  })

  // ⚠️ `datum_hex` must be the bytes the chain carries, not a re-encode: the Plutus encoder
  // writes an empty array definite whatever framing it parsed, and a datum that re-encodes
  // differently hashes differently -- which moves the output, the body and the transaction id.
  it("reports the inline datum's ORIGINAL bytes, not a re-encode", async () => {
    const utxos = await ok(layer.getUtxosByAddress(Address.fromBech32(ADDR)), provider)
    const withDatum = utxos.find((u) => u.input.index === 1)!
    expect(withDatum.output.datum_hex).toBe(REFRAMING_DATUM)
    // The encoder keeps the arrival framing now, so the datum survives a decode/encode round trip
    // as well. Canonical mode is the one caller that still re-derives, and it is the caller that
    // asked to.
    expect(Data.toCBORHex(Data.fromCBORHex(REFRAMING_DATUM))).toBe(REFRAMING_DATUM)
    expect(Data.toCBORHex(Data.fromCBORHex(REFRAMING_DATUM), CBOR.CANONICAL_OPTIONS)).toBe("d87a80")
    expect(withDatum.output.plutus_data).toEqual({ tag: "datum", value: { tag: "constr", alternative: "1", data: [] } })
  })

  it("omits datum_hex when the provider did not preserve the bytes", async () => {
    const built = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex(TX),
      index: 9n,
      address: Address.fromBech32(ADDR),
      assets: Assets.fromLovelace(1n),
      datumOption: new InlineDatum.InlineDatum({ data: Data.fromCBORHex("d87a80") })
    })
    const utxos = await ok(
      layer.getUtxosByAddress(Address.fromBech32(ADDR)),
      new MockProvider({ utxos: [built] })
    )
    expect(utxos[0]!.output.datum_hex).toBeUndefined()
    expect(utxos[0]!.output.plutus_data).toEqual({ tag: "datum", value: { tag: "constr", alternative: "1", data: [] } })
  })
})

describe("getDrepByStakeCredential", () => {
  const dreps: ReadonlyArray<Provider.DRepSummary> = [{ drepId: "drep1real", active: true, amount: 5n }]
  const account = (delegatedDRep: string | null): Provider.AccountInfo => ({
    registered: true,
    delegatedPool: null,
    delegatedDRep,
    rewardsAvailable: 0n,
    deposit: undefined,
    controlledBalance: undefined
  })
  const provider = new MockProvider({
    dreps,
    accounts: {
      [STAKE]: account("drep1real"),
      [STAKE_ABSTAIN]: account("drep_always_abstain"),
      [STAKE_UNDELEGATED]: account(null)
    }
  })

  it("resolves a real delegation target", async () => {
    expect(await ok(layer.getDrepByStakeCredential(STAKE), provider)).toEqual({
      drep_id: "drep1real",
      amount: "5",
      active: true
    })
  })

  // The predefined targets are voting BEHAVIOURS, not registered DReps with stake, so there is
  // no DRepInfo to return for them -- and looking one up would 404 on every backend.
  it("answers null for a predefined target, an undelegated key, and an unknown key", async () => {
    expect(await ok(layer.getDrepByStakeCredential(STAKE_ABSTAIN), provider)).toBeNull()
    expect(await ok(layer.getDrepByStakeCredential(STAKE_UNDELEGATED), provider)).toBeNull()
    expect(await ok(layer.getDrepByStakeCredential(STAKE_UNKNOWN), provider)).toBeNull()
  })
})

describe("the gap list", () => {
  it("documents exactly ten deferred operations, each with a reason", () => {
    expect(Object.keys(Types.UNIMPLEMENTED)).toHaveLength(10)
    for (const [op, why] of Object.entries(Types.UNIMPLEMENTED)) {
      expect(op.startsWith("get")).toBe(true)
      expect(why.length).toBeGreaterThan(20)
    }
  })

  it("twenty implemented plus ten deferred cover the CIP's full operation set", () => {
    expect(Object.keys(layer).length + Object.keys(Types.UNIMPLEMENTED).length).toBe(30)
  })
})
