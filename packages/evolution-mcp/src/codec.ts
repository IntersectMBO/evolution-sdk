import * as Evolution from "@evolution-sdk/evolution"

export interface AssetRecordInput {
  readonly [unit: string]: string | number
}

export interface ProtocolParametersInput {
  readonly minFeeCoefficient: string | number
  readonly minFeeConstant: string | number
  readonly coinsPerUtxoByte: string | number
  readonly maxTxSize: number
  readonly priceMem?: number
  readonly priceStep?: number
  readonly minFeeRefScriptCostPerByte?: number
}

export interface UtxoInput {
  readonly transactionId: string
  readonly index: string | number
  readonly address: string
  readonly assets: AssetRecordInput
  readonly datumOptionCborHex?: string
  readonly scriptRefCborHex?: string
}

const replacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString()
  }

  return value
}

export const toStructured = <T>(value: T): T => JSON.parse(JSON.stringify(value, replacer)) as T

export const parseBigInt = (value: string | number): bigint => {
  if (typeof value === "number") {
    return BigInt(value)
  }

  return BigInt(value)
}

export const parseAddress = (value: string): Evolution.Address.Address => Evolution.Address.fromBech32(value)

export const parseAssets = (value: AssetRecordInput): Evolution.Assets.Assets => {
  const record = Object.fromEntries(Object.entries(value).map(([unit, quantity]) => [unit, parseBigInt(quantity)]))
  return Evolution.Assets.fromRecord(record)
}

export const parseProtocolParameters = (
  value: ProtocolParametersInput
 ) => ({
  minFeeCoefficient: parseBigInt(value.minFeeCoefficient),
  minFeeConstant: parseBigInt(value.minFeeConstant),
  coinsPerUtxoByte: parseBigInt(value.coinsPerUtxoByte),
  maxTxSize: value.maxTxSize,
  priceMem: value.priceMem,
  priceStep: value.priceStep,
  minFeeRefScriptCostPerByte: value.minFeeRefScriptCostPerByte
})

export const parseTransaction = (cborHex: string): Evolution.Transaction.Transaction =>
  Evolution.Transaction.fromCBORHex(cborHex)

export const parseWitnessSet = (cborHex: string): Evolution.TransactionWitnessSet.TransactionWitnessSet =>
  Evolution.TransactionWitnessSet.fromCBORHex(cborHex)

export const parseUtxo = (value: UtxoInput): Evolution.UTxO.UTxO =>
  new Evolution.UTxO.UTxO({
    transactionId: Evolution.TransactionHash.fromHex(value.transactionId),
    index: BigInt(value.index),
    address: parseAddress(value.address),
    assets: parseAssets(value.assets),
    datumOption: value.datumOptionCborHex ? Evolution.DatumOption.fromCBORHex(value.datumOptionCborHex) : undefined,
    scriptRef: value.scriptRefCborHex ? Evolution.Script.fromCBORHex(value.scriptRefCborHex) : undefined
  })

export const parseUtxos = (values: ReadonlyArray<UtxoInput>): Array<Evolution.UTxO.UTxO> => values.map(parseUtxo)

export const serializeAddress = (address: Evolution.Address.Address): string => Evolution.Address.toBech32(address)

export const serializeTransaction = (transaction: Evolution.Transaction.Transaction) => ({
  cborHex: Evolution.Transaction.toCBORHex(transaction),
  json: toStructured(transaction.toJSON())
})

export const serializeWitnessSet = (witnessSet: Evolution.TransactionWitnessSet.TransactionWitnessSet) => ({
  cborHex: Evolution.TransactionWitnessSet.toCBORHex(witnessSet),
  json: toStructured(witnessSet.toJSON())
})

export const serializeUtxo = (utxo: Evolution.UTxO.UTxO) => ({
  outRef: Evolution.UTxO.toOutRefString(utxo),
  json: toStructured(utxo.toJSON())
})

export const serializeUtxos = (utxos: ReadonlyArray<Evolution.UTxO.UTxO>) => utxos.map(serializeUtxo)

export const serializeProtocolParameters = (value: unknown) => toStructured(value)

export const serializeDelegation = (value: { readonly poolId: unknown; readonly rewards: bigint | number }) => ({
  poolId: value.poolId === null ? null : toStructured(value.poolId),
  rewards: value.rewards.toString()
})

export const serializeTransactionHash = (value: Evolution.TransactionHash.TransactionHash): string =>
  Evolution.TransactionHash.toHex(value)