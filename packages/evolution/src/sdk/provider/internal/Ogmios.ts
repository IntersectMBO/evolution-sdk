import type { Record } from "effect"
import { Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import * as AssetName from "../../../AssetName.js"
import type * as CoreAssets from "../../../Assets.js"
import * as Bytes from "../../../Bytes.js"
import * as PlutusData from "../../../Data.js"
import type * as DatumOption from "../../../DatumOption.js"
import * as NativeScripts from "../../../NativeScripts.js"
import * as PolicyId from "../../../PolicyId.js"
import type * as CoreScript from "../../../Script.js"
import * as TransactionHash from "../../../TransactionHash.js"
import type * as CoreUTxO from "../../../UTxO.js"
import * as HttpUtils from "./HttpUtils.js"

export const JSONRPCSchema = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    jsonrpc: Schema.String,
    method: Schema.optional(Schema.String),
    id: Schema.NullOr(Schema.BigInt),
    result: schema
  }).annotations({ identifier: "JSONRPCSchema" })

const LovelaceAsset = Schema.Struct({
  lovelace: Schema.BigInt
})

const TupleNumberFromString = Schema.compose(Schema.split("/"), Schema.Array(Schema.NumberFromString))

export const ProtocolParametersSchema = Schema.Struct({
  minFeeCoefficient: Schema.BigInt,
  minFeeReferenceScripts: Schema.Struct({
    base: Schema.NumberFromString,
    range: Schema.BigInt,
    multiplier: Schema.NumberFromString
  }),
  maxReferenceScriptsSize: Schema.Struct({
    bytes: Schema.BigInt
  }),
  stakePoolVotingThresholds: Schema.Struct({
    noConfidence: TupleNumberFromString,
    constitutionalCommittee: Schema.Struct({
      default: TupleNumberFromString,
      stateOfNoConfidence: TupleNumberFromString
    }),
    hardForkInitiation: TupleNumberFromString,
    protocolParametersUpdate: Schema.Struct({
      security: TupleNumberFromString
    })
  }),
  delegateRepresentativeVotingThresholds: Schema.Struct({
    noConfidence: TupleNumberFromString,
    constitutionalCommittee: Schema.Struct({
      default: TupleNumberFromString,
      stateOfNoConfidence: TupleNumberFromString
    }),
    constitution: TupleNumberFromString,
    hardForkInitiation: TupleNumberFromString,
    protocolParametersUpdate: Schema.Struct({
      network: TupleNumberFromString,
      economic: TupleNumberFromString,
      technical: TupleNumberFromString,
      governance: TupleNumberFromString
    }),
    treasuryWithdrawals: TupleNumberFromString
  }),
  constitutionalCommitteeMinSize: Schema.optional(Schema.BigInt),
  constitutionalCommitteeMaxTermLength: Schema.BigInt,
  governanceActionLifetime: Schema.BigInt,
  governanceActionDeposit: Schema.Struct({
    ada: LovelaceAsset
  }),
  delegateRepresentativeDeposit: Schema.Struct({
    ada: LovelaceAsset
  }),
  delegateRepresentativeMaxIdleTime: Schema.BigInt,
  minFeeConstant: Schema.Struct({ ada: LovelaceAsset }),
  maxBlockBodySize: Schema.Struct({ bytes: Schema.BigInt }),
  maxBlockHeaderSize: Schema.Struct({ bytes: Schema.BigInt }),
  maxTransactionSize: Schema.Struct({ bytes: Schema.BigInt }),
  stakeCredentialDeposit: Schema.Struct({ ada: LovelaceAsset }),
  stakePoolDeposit: Schema.Struct({ ada: LovelaceAsset }),
  stakePoolRetirementEpochBound: Schema.BigInt,
  desiredNumberOfStakePools: Schema.BigInt,
  stakePoolPledgeInfluence: TupleNumberFromString,
  monetaryExpansion: TupleNumberFromString,
  treasuryExpansion: TupleNumberFromString,
  minStakePoolCost: Schema.Struct({ ada: LovelaceAsset }),
  minUtxoDepositConstant: Schema.Struct({ ada: LovelaceAsset }),
  minUtxoDepositCoefficient: Schema.BigInt,
  plutusCostModels: Schema.Struct({
    "plutus:v1": Schema.Array(Schema.BigInt),
    "plutus:v2": Schema.Array(Schema.BigInt),
    "plutus:v3": Schema.Array(Schema.BigInt)
  }),
  scriptExecutionPrices: Schema.Struct({
    memory: TupleNumberFromString,
    cpu: TupleNumberFromString
  }),
  maxExecutionUnitsPerTransaction: Schema.Struct({
    memory: Schema.BigInt,
    cpu: Schema.BigInt
  }),
  maxExecutionUnitsPerBlock: Schema.Struct({ memory: Schema.BigInt, cpu: Schema.BigInt }),
  maxValueSize: Schema.Struct({ bytes: Schema.BigInt }),
  collateralPercentage: Schema.BigInt,
  maxCollateralInputs: Schema.BigInt,
  version: Schema.Struct({ major: Schema.BigInt, minor: Schema.BigInt })
}).annotations({ identifier: "ProtocolParametersSchema" })

export interface ProtocolParameters extends Schema.Schema.Type<typeof ProtocolParametersSchema> {}

export const Delegation = Schema.Array(
  Schema.Struct({
    from: Schema.String,
    credential: Schema.String,
    stakePool: Schema.optional(Schema.Struct({ id: Schema.String })),
    rewards: Schema.Struct({ ada: Schema.Struct({ lovelace: Schema.BigInt }) }),
    deposit: Schema.Struct({ ada: Schema.Struct({ lovelace: Schema.BigInt }) })
  })
)

const Amount = HttpUtils.BigIntFromJsonNumber

const Assets = Schema.Record({ key: Schema.String, value: Schema.Record({ key: Schema.String, value: Amount }) })

const Value = Schema.Struct({ ada: Schema.Struct({ lovelace: Amount }) }, Assets)

export const UTxOSchema = Schema.Struct({
  transaction: Schema.Struct({ id: Schema.String }),
  index: Schema.Number,
  address: Schema.String,
  value: Value,
  datumHash: Schema.optional(Schema.String),
  datum: Schema.optional(Schema.String),
  script: Schema.optional(
    Schema.Struct({
      language: Schema.Literal("native", "plutus:v1", "plutus:v2", "plutus:v3"),
      cbor: Schema.String
    })
  )
})

export type OgmiosAssets = Record<string, Record<string, bigint>>

export type OgmiosUTxO = Schema.Schema.Type<typeof UTxOSchema>

export const EvaluateTransactionSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literal("evaluateTransaction"),
  params: Schema.Struct({
    transaction: Schema.Struct({ cbor: Schema.String }),
    additionalUtxo: Schema.Array(UTxOSchema)
  }),
  id: Schema.Null
})

export type EvaluateTransaction = Schema.Schema.Type<typeof EvaluateTransactionSchema>

export const RedeemerSchema = Schema.Struct({
  validator: Schema.Struct({
    purpose: Schema.Literal("spend", "mint", "publish", "withdraw", "vote", "propose"),
    index: Schema.BigInt
  }),
  budget: Schema.Struct({
    memory: Schema.BigInt,
    cpu: Schema.BigInt
  })
}).annotations({ identifier: "RedeemerSchema" })

export const toOgmiosUTxOs = (utxos: Array<CoreUTxO.UTxO> | undefined): Array<OgmiosUTxO> => {
  // NOTE: Ogmios only works with single encoding, not double encoding.
  // You will get the following error:
  // "Invalid request: couldn't decode Plutus script."
  const toOgmiosScript = (script: CoreScript.Script | undefined): OgmiosUTxO["script"] | undefined => {
    if (script) {
      // Script type directly tells us the language
      switch (script._tag) {
        case "NativeScript":
          // For native scripts, encode the inner script structure
          return { language: "native", cbor: NativeScripts.toCBORHex(script) }
        case "PlutusV1":
          // For Plutus scripts, send only the raw script bytes without CBOR envelope
          // Ogmios v6 expects raw scripts without CBOR tags when using explicit JSON notation
          return { language: "plutus:v1", cbor: Bytes.toHex(script.bytes) }
        case "PlutusV2":
          return { language: "plutus:v2", cbor: Bytes.toHex(script.bytes) }
        case "PlutusV3":
          return { language: "plutus:v3", cbor: Bytes.toHex(script.bytes) }
      }
    }
    return undefined
  }

  const toOgmiosAssets = (assets: CoreAssets.Assets): OgmiosAssets => {
    const newAssets: OgmiosAssets = {}
    if (assets.multiAsset) {
      for (const [policyId, assetMap] of assets.multiAsset.map.entries()) {
        const policyIdHex = PolicyId.toHex(policyId)
        if (!newAssets[policyIdHex]) {
          newAssets[policyIdHex] = {}
        }
        for (const [assetName, quantity] of assetMap.entries()) {
          const assetNameHex = AssetName.toHex(assetName)
          newAssets[policyIdHex][assetNameHex || ""] = quantity
        }
      }
    }
    return newAssets
  }

  const toOgmiosDatum = (datumOption: DatumOption.DatumOption | undefined): { datumHash?: string; datum?: string } => {
    if (!datumOption) return {}
    if (datumOption._tag === "DatumHash") {
      return { datumHash: Bytes.toHex(datumOption.hash) }
    }
    if (datumOption._tag === "InlineDatum") {
      // Convert PlutusData to hex CBOR
      return { datum: PlutusData.toCBORHex(datumOption.data) }
    }
    return {}
  }

  return (utxos || []).map(
    (utxo): OgmiosUTxO => ({
      transaction: {
        id: TransactionHash.toHex(utxo.transactionId)
      },
      index: Number(utxo.index),
      address: CoreAddress.toBech32(utxo.address),
      value: {
        ada: { lovelace: utxo.assets.lovelace },
        ...toOgmiosAssets(utxo.assets)
      },
      ...toOgmiosDatum(utxo.datumOption),
      script: toOgmiosScript(utxo.scriptRef)
    })
  )
}
