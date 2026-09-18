import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as KeyHash from "../src/KeyHash.js"
import * as BlockfrostEffect from "../src/sdk/provider/internal/BlockfrostEffect.js"
import * as KupmiosEffects from "../src/sdk/provider/internal/KupmiosEffects.js"
import * as Kupo from "../src/sdk/provider/internal/Kupo.js"
import * as LosslessJson from "../src/sdk/provider/internal/LosslessJson.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"

// 2^53+1 is the first lovelace amount a JS number cannot hold exactly, and
// 2^64-1 is the largest token quantity the ledger allows.
const UNSAFE_LOVELACE = 9_007_199_254_740_993n // 2^53 + 1
const MAX_UINT64 = 18_446_744_073_709_551_615n // 2^64 - 1
// What the old Number() path produced for each.
const ROUNDED_LOVELACE = "9007199254740992"
const ROUNDED_QUANTITY = "18446744073709552000"

const POLICY_ID = "a".repeat(56)
const ASSET_NAME = "b".repeat(8)

const address = new CoreAddress.Address({
  networkId: 0,
  paymentCredential: KeyHash.fromHex("00".repeat(28))
})
const addressBech32 = CoreAddress.toBech32(address)

const utxoWithHugeAmounts = () => {
  let assets = CoreAssets.fromLovelace(UNSAFE_LOVELACE)
  assets = CoreAssets.addByHex(assets, POLICY_ID, ASSET_NAME, MAX_UINT64)
  return new CoreUTxO.UTxO(
    { transactionId: TransactionHash.fromHex("aa".repeat(32)), index: 0n, address, assets },
    { disableValidation: true }
  )
}

const emptyTx = Transaction.fromCBORHex("84a300d90102800180021800a0f5f6")

/**
 * Stub global fetch, capturing each request body and replying with `body`.
 * The Effect fetch client sends the body as a Uint8Array.
 */
const stubFetch = (body: string) => {
  const sent: Array<string> = []
  vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: unknown }) => {
    const sentBody = init?.body
    if (typeof sentBody === "string") {
      sent.push(sentBody)
    } else if (sentBody instanceof Uint8Array) {
      sent.push(new TextDecoder().decode(sentBody))
    }
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("LosslessJson", () => {
  it("decodes an integer beyond 2^53 as an exact bigint", () => {
    const parsed = LosslessJson.parse(`{"coins":${UNSAFE_LOVELACE},"quantity":${MAX_UINT64}}`) as Record<
      string,
      unknown
    >
    expect(parsed.coins).toBe(UNSAFE_LOVELACE)
    expect(parsed.quantity).toBe(MAX_UINT64)
  })

  it("leaves ordinary small integers as numbers", () => {
    const parsed = LosslessJson.parse('{"index":3,"slot":-12345}') as Record<string, unknown>
    expect(parsed.index).toBe(3)
    expect(parsed.slot).toBe(-12345)
  })

  it("round-trips exactly where JSON.parse corrupts", () => {
    const text = `{"lovelace":${UNSAFE_LOVELACE}}`
    // JSON.parse rounds this to 2^53 before anything downstream can see it.
    expect(BigInt((JSON.parse(text) as { lovelace: number }).lovelace)).not.toBe(UNSAFE_LOVELACE)
    expect(LosslessJson.stringify(LosslessJson.parse(text))).toBe(text)
  })

  it("agrees with JSON.parse on the rest of the grammar", () => {
    const text =
      '{"a":[1,-2.5,1e3,null,true,false],"b":"plain","c":"esc\\"aped \\u0041\\n","d":{"nested":[[]]},"e":{}}'
    expect(LosslessJson.parse(text)).toEqual(JSON.parse(text))
  })

  it("rejects malformed JSON instead of guessing", () => {
    expect(() => LosslessJson.parse('{"a":1')).toThrow(SyntaxError)
    expect(() => LosslessJson.parse('{"a":"unterminated')).toThrow(SyntaxError)
    expect(() => LosslessJson.parse('{"a":1} trailing')).toThrow(SyntaxError)
    expect(() => LosslessJson.parse('{"a":-}')).toThrow(SyntaxError)
  })

  it("normalises either amount form to bigint, and rejects a non-integer", () => {
    const decode = Schema.decodeUnknownSync(LosslessJson.AmountSchema)
    expect(decode(MAX_UINT64)).toBe(MAX_UINT64)
    expect(decode(5_000_000)).toBe(5_000_000n)
    expect(() => decode(1.5)).toThrow()
  })
})

describe("Kupo inbound amounts (#454)", () => {
  it("returns exact amounts from a live-shaped Kupo response", async () => {
    stubFetch(
      LosslessJson.stringify([
        {
          transaction_index: 0,
          transaction_id: "aa".repeat(32),
          output_index: 0,
          address: addressBech32,
          value: { coins: UNSAFE_LOVELACE, assets: { [`${POLICY_ID}.${ASSET_NAME}`]: MAX_UINT64 } },
          datum_hash: null,
          script_hash: null,
          created_at: { slot_no: 1, header_hash: "bb".repeat(32) },
          spent_at: null
        }
      ])
    )

    const [utxo] = await Effect.runPromise(KupmiosEffects.getUtxosEffect("http://kupo.test")(address))

    expect(utxo!.assets.lovelace).toBe(UNSAFE_LOVELACE)
    expect(CoreAssets.getByUnit(utxo!.assets, `${POLICY_ID}${ASSET_NAME}`)).toBe(MAX_UINT64)
  })

  it("still decodes ordinary small amounts", () => {
    const value = Schema.decodeUnknownSync(Kupo.ValueSchema)(LosslessJson.parse('{"coins":5000000,"assets":{}}'))
    expect(value.coins).toBe(5_000_000n)
  })
})

describe("Ogmios protocol parameters", () => {
  // Plutus cost models carry 2^63-1 as a sentinel. Protocol parameters are
  // bounded and typed as numbers, so this request must not be parsed
  // losslessly or the sentinel arrives as a bigint and the schema rejects it.
  // 2^63-1, the value Conway Plutus cost models actually ship.
  const COST_MODEL_SENTINEL = "9223372036854775807"
  const ratio = "1/2"
  const threshold = {
    noConfidence: ratio,
    constitutionalCommittee: { default: ratio, stateOfNoConfidence: ratio },
    hardForkInitiation: ratio,
    protocolParametersUpdate: { security: ratio }
  }
  const protocolParameters = {
    minFeeCoefficient: 44,
    minFeeReferenceScripts: { base: 15, range: 25600, multiplier: 1.2 },
    maxReferenceScriptsSize: { bytes: 204800 },
    stakePoolVotingThresholds: threshold,
    delegateRepresentativeVotingThresholds: {
      ...threshold,
      constitution: ratio,
      protocolParametersUpdate: {
        network: ratio,
        economic: ratio,
        technical: ratio,
        governance: ratio
      },
      treasuryWithdrawals: ratio
    },
    constitutionalCommitteeMaxTermLength: 146,
    governanceActionLifetime: 6,
    governanceActionDeposit: { ada: { lovelace: 100000000000 } },
    delegateRepresentativeDeposit: { ada: { lovelace: 500000000 } },
    delegateRepresentativeMaxIdleTime: 20,
    minFeeConstant: { ada: { lovelace: 155381 } },
    maxBlockBodySize: { bytes: 90112 },
    maxBlockHeaderSize: { bytes: 1100 },
    maxTransactionSize: { bytes: 16384 },
    stakeCredentialDeposit: { ada: { lovelace: 2000000 } },
    stakePoolDeposit: { ada: { lovelace: 500000000 } },
    stakePoolRetirementEpochBound: 18,
    desiredNumberOfStakePools: 500,
    stakePoolPledgeInfluence: "3/10",
    monetaryExpansion: "3/1000",
    treasuryExpansion: "2/10",
    minStakePoolCost: { ada: { lovelace: 170000000 } },
    minUtxoDepositConstant: { ada: { lovelace: 0 } },
    minUtxoDepositCoefficient: 4310,
    plutusCostModels: {
      "plutus:v1": [205665, 812, 1, 1],
      "plutus:v2": [205665, 812, 1, 1],
      // COST_MODEL_SENTINEL is spliced in as a bare integer below; writing it
      // as a JS literal here would itself lose precision.
      "plutus:v3": [205665, 812, "__SENTINEL__", 1]
    },
    scriptExecutionPrices: { memory: "577/10000", cpu: "721/10000000" },
    maxExecutionUnitsPerTransaction: { memory: 14000000, cpu: 10000000000 },
    maxExecutionUnitsPerBlock: { memory: 62000000, cpu: 20000000000 },
    maxValueSize: { bytes: 5000 },
    collateralPercentage: 150,
    maxCollateralInputs: 3,
    version: { major: 10, minor: 0 }
  }

  it("decodes cost models containing the 2^63-1 sentinel", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: null, result: protocolParameters }).replace(
      '"__SENTINEL__"',
      COST_MODEL_SENTINEL
    )
    stubFetch(body)

    const params = await Effect.runPromise(
      KupmiosEffects.getProtocolParametersEffect("http://ogmios.test")
    )

    expect(params.minFeeB).toBe(155381)
    expect(params.keyDeposit).toBe(2_000_000n)
  })
})

describe("Ogmios outbound amounts (#406)", () => {
  it("posts additionalUtxo amounts as exact unquoted integers", async () => {
    const sent = stubFetch('{"jsonrpc":"2.0","id":null,"result":[]}')

    await Effect.runPromise(
      KupmiosEffects.evaluateTxEffect("http://ogmios.test")(emptyTx, [utxoWithHugeAmounts()])
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(`"lovelace":${UNSAFE_LOVELACE}`)
    expect(sent[0]).toContain(`"${ASSET_NAME}":${MAX_UINT64}`)
    // Ogmios rejects quoted amounts, and these are the pre-fix rounded values.
    expect(sent[0]).not.toContain(`"lovelace":"`)
    expect(sent[0]).not.toContain(ROUNDED_LOVELACE)
    expect(sent[0]).not.toContain(ROUNDED_QUANTITY)
  })
})

describe("Blockfrost outbound amounts (#455)", () => {
  it("posts additionalUtxoSet amounts as exact unquoted integers", async () => {
    const sent = stubFetch("[]")

    // The reply shape is irrelevant here; only the request body is under test.
    await Effect.runPromise(
      Effect.either(BlockfrostEffect.evaluateTx("http://blockfrost.test", "key")(emptyTx, [utxoWithHugeAmounts()]))
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(`"coins":${UNSAFE_LOVELACE}`)
    expect(sent[0]).toContain(`"${ASSET_NAME}":${MAX_UINT64}`)
    expect(sent[0]).not.toContain(ROUNDED_LOVELACE)
    expect(sent[0]).not.toContain(ROUNDED_QUANTITY)
  })
})
