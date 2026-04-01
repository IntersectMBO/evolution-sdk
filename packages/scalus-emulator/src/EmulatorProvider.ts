import * as Address from "@evolution-sdk/evolution/Address"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as CBOR from "@evolution-sdk/evolution/CBOR"
import type * as Credential from "@evolution-sdk/evolution/Credential"
import * as Redeemer from "@evolution-sdk/evolution/Redeemer"
import * as Script from "@evolution-sdk/evolution/Script"
import * as ScriptRef from "@evolution-sdk/evolution/ScriptRef"
import type { EvalRedeemer } from "@evolution-sdk/evolution/sdk/EvalRedeemer"
import { ProviderError } from "@evolution-sdk/evolution/sdk/provider/Provider"
import type { Provider, ProviderEffect, ProtocolParameters } from "@evolution-sdk/evolution/sdk/provider/Provider"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionInput from "@evolution-sdk/evolution/TransactionInput"
import * as TxOut from "@evolution-sdk/evolution/TxOut"
import * as UTxO from "@evolution-sdk/evolution/UTxO"
import { Effect, Equal, Schema } from "effect"
import * as Scalus from "scalus"

type Emulator = Scalus.Emulator
type SlotConfig = Scalus.SlotConfig

/**
 * Decode a single CBOR-encoded UTxO entry (Map with one key-value pair)
 * from the Scalus emulator into an Evolution SDK UTxO.
 */
function decodeUtxoEntry(cborBytes: Uint8Array): UTxO.UTxO {
  const decoded = CBOR.internalDecodeSync(cborBytes, CBOR.CML_DEFAULT_OPTIONS) as Map<unknown, unknown>
  const [[key, value]] = decoded.entries()
  const txInput = Schema.decodeSync(TransactionInput.FromCDDL)(key as any)
  const txOutput = Schema.decodeSync(TxOut.FromCDDL)(value as any)
  return new UTxO.UTxO({
    transactionId: txInput.transactionId,
    index: BigInt(txInput.index),
    address: txOutput.address,
    assets: txOutput.assets,
    datumOption: txOutput.datumOption,
    scriptRef: txOutput.scriptRef ? Script.fromCBOR(txOutput.scriptRef.bytes) : undefined
  })
}

/**
 * Build CBOR-encoded UTxO map from Evolution SDK UTxOs for Scalus evaluation.
 */
function buildUtxoMapCBOR(utxos: ReadonlyArray<UTxO.UTxO>): Uint8Array {
  const utxoMap = new Map<CBOR.CBOR, CBOR.CBOR>()
  for (const utxo of utxos) {
    const txInput = new TransactionInput.TransactionInput({
      transactionId: utxo.transactionId,
      index: utxo.index
    })
    const inputCBOR = Schema.encodeSync(TransactionInput.FromCDDL)(txInput)
    const scriptRef = utxo.scriptRef ? new ScriptRef.ScriptRef({ bytes: Script.toCBOR(utxo.scriptRef) }) : undefined
    const txOut = new TxOut.TransactionOutput({
      address: utxo.address,
      assets: utxo.assets,
      datumOption: utxo.datumOption,
      scriptRef
    })
    const outputCBOR = Schema.encodeSync(TxOut.FromCDDL)(txOut)
    utxoMap.set(inputCBOR, outputCBOR)
  }
  return CBOR.toCBORBytes(utxoMap, CBOR.CML_DEFAULT_OPTIONS)
}

/** Default protocol parameters matching Cardano mainnet. */
const DEFAULT_PROTOCOL_PARAMETERS: ProtocolParameters = {
  minFeeA: 44,
  minFeeB: 155381,
  maxTxSize: 16384,
  maxValSize: 5000,
  keyDeposit: 2000000n,
  poolDeposit: 500000000n,
  drepDeposit: 500000000n,
  govActionDeposit: 100000000000n,
  priceMem: 0.0577,
  priceStep: 0.0000721,
  maxTxExMem: 14000000n,
  maxTxExSteps: 10000000000n,
  coinsPerUtxoByte: 4310n,
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  minFeeRefScriptCostPerByte: 15,
  costModels: {
    PlutusV1: {},
    PlutusV2: {},
    PlutusV3: {}
  }
}

/** Redeemer tag mapping from Scalus to Evolution SDK. */
const REDEEMER_TAG_MAP: Record<string, Redeemer.RedeemerTag> = {
  Spend: "spend",
  Mint: "mint",
  Cert: "cert",
  Reward: "reward",
  Voting: "vote",
  Proposing: "propose"
}

/**
 * Scalus Emulator provider for Evolution SDK.
 * Implements the Provider interface backed by a local Scalus Cardano emulator.
 *
 * @since 0.0.1
 * @category constructors
 */
export class ScalusEmulatorProvider implements Provider {
  readonly Effect: ProviderEffect
  readonly emulator: Emulator
  readonly slotConfig: SlotConfig
  readonly protocolParameters: ProtocolParameters

  constructor(emulator: Emulator, slotConfig: SlotConfig, protocolParameters?: ProtocolParameters) {
    this.emulator = emulator
    this.slotConfig = slotConfig
    this.protocolParameters = protocolParameters ?? DEFAULT_PROTOCOL_PARAMETERS

    const self = this

    this.Effect = {
      getProtocolParameters: () => Effect.succeed(self.protocolParameters),

      getUtxos: (addressOrCredential) =>
        Effect.try({
          try: () => {
            const allEntries = self.emulator.getAllUtxos()
            const utxos: Array<UTxO.UTxO> = []
            for (const entry of allEntries) {
              const utxo = decodeUtxoEntry(entry)
              if (matchesAddressOrCredential(utxo.address, addressOrCredential)) {
                utxos.push(utxo)
              }
            }
            return utxos
          },
          catch: (error) => new ProviderError({ cause: error, message: `Failed to get UTxOs: ${error}` })
        }),

      getUtxosWithUnit: (addressOrCredential, unit) =>
        Effect.try({
          try: () => {
            const allEntries = self.emulator.getAllUtxos()
            const utxos: Array<UTxO.UTxO> = []
            for (const entry of allEntries) {
              const utxo = decodeUtxoEntry(entry)
              if (matchesAddressOrCredential(utxo.address, addressOrCredential) && hasUnit(utxo, unit)) {
                utxos.push(utxo)
              }
            }
            return utxos
          },
          catch: (error) => new ProviderError({ cause: error, message: `Failed to get UTxOs with unit: ${error}` })
        }),

      getUtxoByUnit: (unit) =>
        Effect.try({
          try: () => {
            const allEntries = self.emulator.getAllUtxos()
            for (const entry of allEntries) {
              const utxo = decodeUtxoEntry(entry)
              if (hasUnit(utxo, unit)) {
                return utxo
              }
            }
            throw new Error(`UTxO with unit ${unit} not found`)
          },
          catch: (error) => new ProviderError({ cause: error, message: `Failed to get UTxO by unit: ${error}` })
        }),

      getUtxosByOutRef: (inputs) =>
        Effect.try({
          try: () => {
            const allEntries = self.emulator.getAllUtxos()
            const utxos: Array<UTxO.UTxO> = []
            for (const entry of allEntries) {
              const utxo = decodeUtxoEntry(entry)
              for (const input of inputs) {
                if (
                  Equal.equals(utxo.transactionId, input.transactionId) &&
                  utxo.index === BigInt(input.index)
                ) {
                  utxos.push(utxo)
                  break
                }
              }
            }
            return utxos
          },
          catch: (error) => new ProviderError({ cause: error, message: `Failed to get UTxOs by outRef: ${error}` })
        }),

      getDelegation: () =>
        Effect.succeed({ poolId: null, rewards: 0n }),

      getDatum: (datumHash) =>
        Effect.fail(
          new ProviderError({ cause: null, message: `getDatum not supported by emulator (hash: ${datumHash})` })
        ),

      awaitTx: () => Effect.succeed(true),

      submitTx: (tx) =>
        Effect.try({
          try: () => {
            const txBytes = Transaction.toCBORBytes(tx)
            const result = self.emulator.submitTx(txBytes)
            if (!result.isSuccess) {
              const logs = result.logs?.join("\n") ?? ""
              throw new Error(`Transaction rejected: ${result.error}${logs ? `\nLogs:\n${logs}` : ""}`)
            }
            return TransactionHash.fromHex(result.txHash!)
          },
          catch: (error) => new ProviderError({ cause: error, message: `Failed to submit transaction: ${error}` })
        }),

      evaluateTx: (tx, additionalUTxOs) =>
        Effect.try({
          try: () => {
            const txBytes = Transaction.toCBORBytes(tx)
            const allEntries = self.emulator.getAllUtxos()
            const allUtxos = allEntries.map(decodeUtxoEntry)
            if (additionalUTxOs) {
              allUtxos.push(...additionalUTxOs)
            }
            const utxosBytes = buildUtxoMapCBOR(allUtxos)

            const costModels = self.protocolParameters.costModels
            const costModelArrays = [
              Object.values(costModels.PlutusV1),
              Object.values(costModels.PlutusV2),
              Object.values(costModels.PlutusV3)
            ]

            const scalusSlotConfig = new Scalus.SlotConfig(
              self.slotConfig.slotToTime(0),
              0,
              1000
            )

            const redeemers = Scalus.Scalus.evalPlutusScripts(txBytes, utxosBytes, scalusSlotConfig, costModelArrays)

            return redeemers.map((r): EvalRedeemer => ({
              redeemer_tag: REDEEMER_TAG_MAP[r.tag] || "spend",
              redeemer_index: r.index,
              ex_units: new Redeemer.ExUnits({ mem: BigInt(r.budget.memory), steps: BigInt(r.budget.steps) })
            }))
          },
          catch: (error) => new ProviderError({ cause: error, message: `Failed to evaluate transaction: ${error}` })
        })
    }
  }

  getProtocolParameters = () => Effect.runPromise(this.Effect.getProtocolParameters())
  getUtxos = (addressOrCredential: Parameters<Provider["getUtxos"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxos(addressOrCredential))
  getUtxosWithUnit = (
    addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider["getUtxosWithUnit"]>[1]
  ) => Effect.runPromise(this.Effect.getUtxosWithUnit(addressOrCredential, unit))
  getUtxoByUnit = (unit: Parameters<Provider["getUtxoByUnit"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxoByUnit(unit))
  getUtxosByOutRef = (outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]) =>
    Effect.runPromise(this.Effect.getUtxosByOutRef(outRefs))
  getDelegation = (rewardAddress: Parameters<Provider["getDelegation"]>[0]) =>
    Effect.runPromise(this.Effect.getDelegation(rewardAddress))
  getDatum = (datumHash: Parameters<Provider["getDatum"]>[0]) =>
    Effect.runPromise(this.Effect.getDatum(datumHash))
  awaitTx = (txHash: Parameters<Provider["awaitTx"]>[0], checkInterval?: Parameters<Provider["awaitTx"]>[1]) =>
    Effect.runPromise(this.Effect.awaitTx(txHash, checkInterval))
  submitTx = (tx: Parameters<Provider["submitTx"]>[0]) =>
    Effect.runPromise(this.Effect.submitTx(tx))
  evaluateTx = (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
    Effect.runPromise(this.Effect.evaluateTx(tx, additionalUTxOs))
}

/** Check if a UTxO contains a specific unit (policyId + assetName hex concatenated). */
function hasUnit(utxo: UTxO.UTxO, unit: string): boolean {
  if (unit === "lovelace") return utxo.assets.lovelace > 0n
  const multiAsset = utxo.assets.multiAsset
  if (!multiAsset) return false
  const policyIdHex = unit.slice(0, 56)
  const assetNameHex = unit.slice(56)
  for (const [policyId, assets] of multiAsset.map) {
    const pIdHex = Bytes.toHex(policyId.hash)
    if (pIdHex !== policyIdHex) continue
    for (const [assetName, quantity] of assets) {
      const aNameHex = Bytes.toHex(assetName.bytes)
      if (aNameHex === assetNameHex && quantity > 0n) return true
    }
  }
  return false
}

/** Check if an address matches an Address or Credential filter. */
function matchesAddressOrCredential(
  address: Address.Address,
  filter: Address.Address | Credential.Credential
): boolean {
  if (filter instanceof Address.Address) {
    return Equal.equals(address, filter)
  }
  return Equal.equals(address.paymentCredential, filter)
}
