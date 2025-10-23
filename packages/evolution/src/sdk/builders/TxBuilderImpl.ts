// Effect-TS imports
import { Effect, Ref, Schema } from "effect"

// Core imports
import * as AddressEras from "../../core/AddressEras.js"
import * as Bytes32 from "../../core/Bytes32.js"
import * as PlutusData from "../../core/Data.js"
import * as DatumOption from "../../core/DatumOption.js"
import * as Ed25519Signature from "../../core/Ed25519Signature.js"
import * as Transaction from "../../core/Transaction.js"
import * as TransactionBody from "../../core/TransactionBody.js"
import * as TransactionHash from "../../core/TransactionHash.js"
import * as TransactionInput from "../../core/TransactionInput.js"
import * as TransactionOutput from "../../core/TransactionOutput.js"
import * as TransactionWitnessSet from "../../core/TransactionWitnessSet.js"
import * as VKey from "../../core/VKey.js"
// SDK imports
import * as Address from "../Address.js"
import * as Assets from "../Assets.js"
import type * as Datum from "../Datum.js"
import * as UTxO from "../UTxO.js"
// Internal imports
import type { CollectFromParams, PayToAddressParams } from "./operations/Operations.js"
import type { UnfrackOptions } from "./TransactionBuilder.js"
import { TransactionBuilderError, TxContext } from "./TransactionBuilder.js"
import * as Unfrack from "./Unfrack.js"

// ============================================================================
// TransactionBuilder Effect Programs Implementation
// ============================================================================

/**
 * This file contains the program creators that generate ProgramSteps.
 * ProgramSteps are deferred Effects executed during build() with fresh state.
 * 
 * Architecture:
 * - Program creators return deferred Effects (ProgramSteps)
 * - Programs access TxContext (single unified Context) containing config, state, and options
 * - Programs are executed with fresh state on each build() call
 * - No state mutation between builds - complete isolation
 * - No prop drilling - everything accessible via single Context
 */

// ============================================================================
// Helper Functions - Address Utilities
// ============================================================================

/**
 * Check if an address is a script address (payment credential is ScriptHash).
 * Parses the address to extract its structure and checks the payment credential type.
 * 
 * @since 2.0.0
 * @category helpers
 */
export const isScriptAddress = (address: string): Effect.Effect<boolean, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Parse address to structure
    const addressStructure = yield* Effect.try({
      try: () => Address.toAddressStructure(address),
      catch: (error) =>
        new TransactionBuilderError({
          message: `Failed to parse address: ${address}`,
          cause: error
        })
    })

    // Check if payment credential is a script hash
    return addressStructure.paymentCredential._tag === "ScriptHash"
  })

/**
 * Filter UTxOs to find those locked by scripts (script-locked UTxOs).
 * 
 * @since 2.0.0
 * @category helpers
 */
export const filterScriptUtxos = (
  utxos: ReadonlyArray<UTxO.UTxO>
): Effect.Effect<ReadonlyArray<UTxO.UTxO>, TransactionBuilderError> =>
  Effect.gen(function* () {
    const scriptUtxos: Array<UTxO.UTxO> = []

    for (const utxo of utxos) {
      const isScript = yield* isScriptAddress(utxo.address)
      if (isScript) {
        scriptUtxos.push(utxo)
      }
    }

    return scriptUtxos
  })

// ============================================================================
// Helper Functions - Asset Utilities
// ============================================================================

/**
 * Calculate total assets from a set of UTxOs.
 * 
 * @since 2.0.0
 * @category helpers
 */
export const calculateTotalAssets = (utxos: ReadonlyArray<UTxO.UTxO> | Set<UTxO.UTxO>): Assets.Assets => {
  const utxoArray = Array.isArray(utxos) ? utxos : Array.from(utxos)
  return utxoArray.reduce((total, utxo) => Assets.add(total, utxo.assets), Assets.empty())
}

// ============================================================================
// Helper Functions - Output Construction
// ============================================================================

/**
 * Convert SDK Datum to core DatumOption.
 * Parses CBOR hex strings for inline datums and hashes for datum references.
 * 
 * @since 2.0.0
 * @category helpers
 */
export const makeDatumOption = (datum: Datum.Datum): Effect.Effect<DatumOption.DatumOption, TransactionBuilderError> =>
  Effect.gen(function* () {
    if (datum.type === "inlineDatum") {
      // Parse PlutusData from CBOR hex using Schema
      const plutusData = yield* Schema.decodeUnknown(PlutusData.FromCBORHex())(datum.inline)
      return DatumOption.makeInlineDatum({ data: plutusData })
    }

    if (datum.type === "datumHash") {
      // Parse datum hash from hex string to Uint8Array using Schema
      const hashBytes = yield* Schema.decodeUnknown(Bytes32.BytesFromHex)(datum.hash)
      return DatumOption.makeDatumHash({ hash: hashBytes })
    }

    return yield* Effect.fail(
      new TransactionBuilderError({
        message: `Unknown datum type: ${(datum as any).type}`
      })
    )
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: `Failed to parse datum: ${JSON.stringify(datum)}`,
          cause: error
        })
    )
  )

/**
 * Create a TxOutput from user-friendly parameters.
 * Stays in SDK types for easier manipulation (merging, etc).
 * 
 * TxOutput represents an output being created in a transaction - it doesn't have
 * txHash/outputIndex yet since the transaction hasn't been submitted.
 * 
 * @since 2.0.0
 * @category helpers
 */
export const makeTxOutput = (params: {
  address: string
  assets: Assets.Assets
  datum?: Datum.Datum
  scriptRef?: any // TODO: Add ScriptRef type
}): Effect.Effect<UTxO.TxOutput, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Validate address format using Schema (will fail if invalid bech32)
    yield* Schema.decodeUnknown(AddressEras.FromBech32)(params.address)
    
    // Create SDK TxOutput (no txHash/outputIndex until transaction is submitted)
    const output: UTxO.TxOutput = {
      address: params.address,
      assets: params.assets,
      datumOption: params.datum,
      scriptRef: params.scriptRef
    }
    
    return output
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: `Failed to create TxOutput for address: ${params.address}`,
          cause: error
        })
    )
  )

/**
 * Convert SDK TxOutput to core TransactionOutput.
 * This is an internal conversion function used during transaction assembly.
 * Converts SDK types (Assets, Datum) to core CML types (Value, DatumOption).
 * 
 * @since 2.0.0
 * @category helpers
 * @internal
 */
export const txOutputToTransactionOutput = (params: {
  address: string
  assets: Assets.Assets
  datum?: Datum.Datum
  scriptRef?: any // TODO: Add ScriptRef type
}): Effect.Effect<TransactionOutput.TransactionOutput, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Parse address from bech32 string to core Address type using Schema
    const address = yield* Schema.decodeUnknown(AddressEras.FromBech32)(params.address)

    // Convert assets to Value (core type)
    const value = Assets.assetsToValue(params.assets)

    // Convert datum if provided
    let datumOption: DatumOption.DatumOption | undefined
    if (params.datum) {
      datumOption = yield* makeDatumOption(params.datum)
    }

    // Create BabbageTransactionOutput (current era)
    const output = new TransactionOutput.BabbageTransactionOutput({
      address,
      amount: value,
      datumOption,
      scriptRef: params.scriptRef
    })

    return output
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: `Failed to create transaction output for address: ${params.address}`,
          cause: error
        })
    )
  )

/**
 * Merge additional assets into an existing UTxO (output).
 * Creates a new UTxO with combined assets from the original UTxO and additional assets.
 * 
 * Use case: Draining wallet by merging leftover into an existing payment output.
 * 
 * @param utxo - The original UTxO output to merge into
 * @param additionalAssets - The additional assets to add
 * @returns Effect with the merged UTxO
 * 
 * @since 2.0.0
 * @category helpers
 */
export const mergeAssetsIntoUTxO = (
  utxo: UTxO.UTxO,
  additionalAssets: Assets.Assets
): Effect.Effect<UTxO.UTxO, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Use UTxO.addAssets helper to merge assets
    const mergedUTxO = UTxO.addAssets(utxo, additionalAssets)
    return mergedUTxO
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Failed to merge assets into UTxO",
          cause: error
        })
    )
  )

/**
 * Merge additional assets into an existing TransactionOutput.
 * Creates a new output with combined assets from the original output and leftover assets.
 * 
 * Use case: Draining wallet by merging leftover into an existing payment output.
 * 
 * @deprecated Use mergeAssetsIntoUTxO instead. This function works with core types and will be removed.
 * 
 * @since 2.0.0
 * @category helpers
 */
export const mergeAssetsIntoOutput = (
  output: TransactionOutput.TransactionOutput,
  additionalAssets: Assets.Assets
): Effect.Effect<TransactionOutput.TransactionOutput, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Extract current assets from output
    const currentAssets = Assets.valueToAssets(output.amount)
    
    // Merge assets
    const mergedAssets = Assets.add(currentAssets, additionalAssets)
    
    // Convert merged assets back to Value
    const newValue = Assets.assetsToValue(mergedAssets)
    
    // Create new output with merged value, preserving type and optional fields
    if (output instanceof TransactionOutput.BabbageTransactionOutput) {
      const newOutput = new TransactionOutput.BabbageTransactionOutput({
        address: output.address,
        amount: newValue,
        datumOption: output.datumOption,
        scriptRef: output.scriptRef
      })
      return newOutput
    } else {
      // Shelley output
      const newOutput = new TransactionOutput.ShelleyTransactionOutput({
        address: output.address,
        amount: newValue
      })
      return newOutput
    }
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Failed to merge assets into output",
          cause: error
        })
    )
  )

// ============================================================================
// Operation Effect Programs
// ============================================================================

/**
 * Creates a ProgramStep for payToAddress operation.
 * Creates a UTxO output and tracks assets for balancing.
 * 
 * Implementation:
 * 1. Creates UTxO output from parameters using helper
 * 2. Adds output to state.outputs array
 * 3. Updates totalOutputAssets for balancing
 * 
 * @since 2.0.0
 * @category programs
 */
export const createPayToAddressProgram = (params: PayToAddressParams) =>
  Effect.gen(function* () {
    const ctx = yield* TxContext

    // 1. Create UTxO output from params
    const output = yield* makeTxOutput({
      address: params.address,
      assets: params.assets,
      datum: params.datum,
      scriptRef: params.scriptRef
    })

    // 2. Add output to state
    yield* Ref.update(ctx.state.outputs, (outputs) => [...outputs, output])

    // 3. Track total output assets for balancing
    yield* Ref.update(ctx.state.totalOutputAssets, (currentAssets) => {
      return Assets.add(currentAssets, params.assets)
    })
  })

/**
 * Creates a ProgramStep for collectFrom operation.
 * Adds UTxOs as transaction inputs, validates script requirements, and tracks assets.
 * 
 * Implementation:
 * 1. Validates that inputs array is not empty
 * 2. Checks if any inputs are script-locked (require redeemers)
 * 3. Validates redeemer is provided for script-locked UTxOs
 * 4. Adds UTxOs to state.selectedUtxos
 * 5. Tracks redeemer information for script spending
 * 6. Updates total input assets for balancing
 * 
 * @since 2.0.0
 * @category programs
 */
export const createCollectFromProgram = (params: CollectFromParams) =>
  Effect.gen(function* () {
    const ctx = yield* TxContext

    // 1. Validate inputs exist
    if (params.inputs.length === 0) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: "No inputs provided to collectFrom"
        })
      )
    }

    // 2. Filter script-locked UTxOs
    const scriptUtxos = yield* filterScriptUtxos(params.inputs)

    // 3. Validate redeemer for script UTxOs
    if (scriptUtxos.length > 0 && !params.redeemer) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: `Redeemer required for ${scriptUtxos.length} script-locked UTxO(s)`
        })
      )
    }

    // 4. Add UTxOs to selected inputs (Array.concat for immutable append)
    yield* Ref.update(ctx.state.selectedUtxos, (selected) => {
      return [...selected, ...params.inputs]
    })

    // 5. Track redeemer information if spending from scripts
    if (params.redeemer && scriptUtxos.length > 0) {
      // Store redeemer data for each script UTxO
      // Redeemer is indexed by input reference (txHash#outputIndex)
      // Index field will be set later during witness assembly based on input ordering
      yield* Ref.update(ctx.state.redeemers, (redeemers) => {
        const updated = new Map(redeemers)
        scriptUtxos.forEach((utxo) => {
          const inputKey = `${utxo.txHash}#${utxo.outputIndex}`
          updated.set(inputKey, {
            tag: "spend",
            data: params.redeemer!, // PlutusData CBOR hex
            // exUnits will be filled by script evaluator during build phase
            exUnits: undefined
          })
        })
        return updated
      })
    }

    // 6. Track total input assets for balancing
    const inputAssets = calculateTotalAssets(params.inputs)
    
    // Update state with accumulated input assets
    yield* Ref.update(ctx.state.totalInputAssets, (currentAssets) => {
      return Assets.add(currentAssets, inputAssets)
    })
  })

// ============================================================================
// Transaction Assembly
// ============================================================================

/**
 * Convert an array of UTxOs to an array of TransactionInputs.
 * Inputs are sorted by txHash then outputIndex for deterministic ordering.
 * Converts SDK types (UTxO.UTxO) to core types (TransactionInput).
 * 
 * @since 2.0.0
 * @category assembly
 */
export const buildTransactionInputs = (
  utxos: ReadonlyArray<UTxO.UTxO>
): Effect.Effect<ReadonlyArray<TransactionInput.TransactionInput>, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Convert each UTxO to TransactionInput
    const inputs: Array<TransactionInput.TransactionInput> = []
    
    for (const utxo of utxos) {
      // Parse transaction hash from hex string
      const txHash = yield* Schema.decodeUnknown(TransactionHash.FromHex)(utxo.txHash)
      
      // Create TransactionInput
      const input = new TransactionInput.TransactionInput({
        transactionId: txHash,
        index: BigInt(utxo.outputIndex)
      })
      
      inputs.push(input)
    }

    // Sort inputs for deterministic ordering:
    // First by transaction hash, then by output index
    inputs.sort((a, b) => {
      // Compare transaction hashes (byte arrays)
      const hashA = a.transactionId.hash
      const hashB = b.transactionId.hash
      
      for (let i = 0; i < hashA.length; i++) {
        if (hashA[i] !== hashB[i]) {
          return hashA[i] - hashB[i]
        }
      }
      
      // If hashes are equal, compare by index
      return Number(a.index - b.index)
    })

    return inputs
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Failed to build transaction inputs",
          cause: error
        })
    )
  )

/**
 * Assemble a Transaction from inputs, outputs, and calculated fee.
 * Creates TransactionBody with all required fields.
 * 
 * This is where SDK UTxO outputs are converted to core TransactionOutputs.
 * 
 * This is minimal assembly with accurate fee:
 * - Build witness set with redeemers and signatures (Step 4 - future)
 * - Run script evaluation to fill ExUnits (Step 5 - future)
 * - Add change output (Step 6 - future)
 * 
 * @since 2.0.0
 * @category assembly
 */
export const assembleTransaction = (
  inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  outputs: ReadonlyArray<UTxO.TxOutput>,
  fee: bigint
): Effect.Effect<Transaction.Transaction, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Convert SDK TxOutput outputs to core TransactionOutputs
    const transactionOutputs: Array<TransactionOutput.TransactionOutput> = yield* Effect.all(
      outputs.map((output) =>
        txOutputToTransactionOutput({
          address: output.address,
          assets: output.assets,
          datum: output.datumOption,
          scriptRef: output.scriptRef
        })
      )
    )
    
    // Create TransactionBody with calculated fee
    const body = new TransactionBody.TransactionBody({
      inputs: inputs as Array<TransactionInput.TransactionInput>,
      outputs: transactionOutputs,
      fee  // Now using actual calculated fee, not placeholder
      // Optional fields omitted for now:
      // - ttl: will be set if setValidityRange is called
      // - certificates: will be set if certificate operations added
      // - withdrawals: will be set if withdrawal operations added
      // - auxiliaryDataHash: will be set if metadata added
      // - validityIntervalStart: will be set if setValidityRange is called
      // - mint: will be set if mint/burn operations added
      // - scriptDataHash: will be calculated when building witness set
      // - collateralInputs: will be set during witness building
      // - requiredSigners: will be set if addSigner is called
      // - networkId: will be set from config
      // - collateralReturn: will be calculated during witness building
      // - totalCollateral: will be calculated during witness building
      // - referenceInputs: will be set if reference inputs added
      // - votingProcedures: N/A for transaction building
      // - proposalProcedures: N/A for transaction building
      // - currentTreasuryValue: N/A for transaction building
      // - donation: N/A for transaction building
    })

    // Create empty witness set (will be populated in Step 4)
    const witnessSet = new TransactionWitnessSet.TransactionWitnessSet({
      vkeyWitnesses: [],
      nativeScripts: [],
      bootstrapWitnesses: [],
      plutusV1Scripts: [],
      plutusData: [],
      redeemers: [],
      plutusV2Scripts: [],
      plutusV3Scripts: []
    })

    // Create Transaction
    const transaction = new Transaction.Transaction({
      body,
      witnessSet,
      isValid: true, // Assume valid until script evaluation proves otherwise
      auxiliaryData: null // Will be set if metadata operations added
    })

    return transaction
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Failed to assemble transaction",
          cause: error
        })
    )
  )

// ============================================================================
// Fee Calculation
// ============================================================================

/**
 * Calculate the size of a transaction in bytes for fee estimation.
 * Uses CBOR serialization to get accurate size.
 * 
 * @since 2.0.0
 * @category fee-calculation
 */
export const calculateTransactionSize = (
  transaction: Transaction.Transaction
): Effect.Effect<number, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Serialize transaction to CBOR bytes using sync function
    const cborBytes = yield* Effect.try({
      try: () => Transaction.toCBORBytes(transaction),
      catch: (error) =>
        new TransactionBuilderError({
          message: "Failed to encode transaction to CBOR",
          cause: error
        })
    })
    
    return cborBytes.length
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Failed to calculate transaction size",
          cause: error
        })
    )
  )

/**
 * Calculate minimum transaction fee based on protocol parameters.
 * 
 * Formula: minFee = txSizeInBytes × minFeeCoefficient + minFeeConstant
 * 
 * @since 2.0.0
 * @category fee-calculation
 */
export const calculateMinimumFee = (
  transactionSizeBytes: number,
  protocolParams: {
    minFeeCoefficient: bigint  // minFeeA
    minFeeConstant: bigint      // minFeeB
  }
): bigint => {
  const { minFeeCoefficient, minFeeConstant } = protocolParams
  
  return (BigInt(transactionSizeBytes) * minFeeCoefficient) + minFeeConstant
}

/**
 * Extract payment key hash from a Cardano address.
 * Returns null if address has script credential or no payment credential.
 * 
 * @since 2.0.0
 * @category fee-calculation
 * @internal
 */
const extractPaymentKeyHash = (
  address: string
): Effect.Effect<Uint8Array | null, TransactionBuilderError> =>
  Effect.gen(function* () {
    const addressStructure = yield* Effect.try({
      try: () => Address.toAddressStructure(address),
      catch: (error) =>
        new TransactionBuilderError({
          message: `Failed to parse address ${address}`,
          cause: error
        })
    })

    // Check if payment credential is a KeyHash
    if (
      addressStructure.paymentCredential?._tag === "KeyHash" &&
      addressStructure.paymentCredential.hash
    ) {
      return addressStructure.paymentCredential.hash
    }

    return null
  })

/**
 * Build a fake VKeyWitness for fee estimation.
 * Creates a witness with 32-byte vkey and 64-byte signature (96 bytes total).
 * This matches CML's approach for accurate witness size calculation.
 * 
 * @since 2.0.0
 * @category fee-calculation
 * @internal
 */
const buildFakeVKeyWitness = (
  keyHash: Uint8Array
): Effect.Effect<TransactionWitnessSet.VKeyWitness, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Pad key hash to 32 bytes for vkey (Ed25519 public key size)
    const vkeyBytes = new Uint8Array(32)
    vkeyBytes.set(keyHash.slice(0, Math.min(keyHash.length, 32)))

    // Create 64-byte dummy signature (Ed25519 signature size)
    const signatureBytes = new Uint8Array(64)

    const vkey = yield* Effect.try({
      try: () => VKey.make({ bytes: vkeyBytes }),
      catch: (error) =>
        new TransactionBuilderError({
          message: "Failed to create fake VKey",
          cause: error
        })
    })

    const signature = yield* Effect.try({
      try: () => Ed25519Signature.make({ bytes: signatureBytes }),
      catch: (error) =>
        new TransactionBuilderError({
          message: "Failed to create fake signature",
          cause: error
        })
    })

    return new TransactionWitnessSet.VKeyWitness({
      vkey,
      signature
    })
  })

/**
 * Build a fake witness set for fee estimation from transaction inputs.
 * Extracts unique payment key hashes from input addresses and creates
 * fake witnesses to accurately estimate witness set size in CBOR.
 * 
 * @since 2.0.0
 * @category fee-calculation
 */
export const buildFakeWitnessSet = (
  inputUtxos: ReadonlyArray<UTxO.UTxO>
): Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Extract unique key hashes from input addresses
    const keyHashesSet = new Set<string>()
    const keyHashes: Array<Uint8Array> = []

    for (const utxo of inputUtxos) {
      const keyHash = yield* extractPaymentKeyHash(utxo.address)
      if (keyHash) {
        const keyHashHex = Buffer.from(keyHash).toString("hex")
        if (!keyHashesSet.has(keyHashHex)) {
          keyHashesSet.add(keyHashHex)
          keyHashes.push(keyHash)
        }
      }
    }

    // Build fake witnesses for each unique key hash
    const vkeyWitnesses: Array<TransactionWitnessSet.VKeyWitness> = []
    for (const keyHash of keyHashes) {
      const witness = yield* buildFakeVKeyWitness(keyHash)
      vkeyWitnesses.push(witness)
    }

    return new TransactionWitnessSet.TransactionWitnessSet({
      vkeyWitnesses,
      nativeScripts: [],
      bootstrapWitnesses: [],
      plutusV1Scripts: [],
      plutusData: [],
      redeemers: [],
      plutusV2Scripts: [],
      plutusV3Scripts: []
    })
  })

/**
 * Calculate transaction fee iteratively until stable.
 * 
 * Algorithm:
 * 1. Build fake witness set from input UTxOs for accurate size estimation
 * 2. Build transaction with fee = 0
 * 3. Calculate size and fee
 * 4. Rebuild transaction with calculated fee
 * 5. If size changed, recalculate (usually converges in 1-2 iterations)
 * 
 * @since 2.0.0
 * @category fee-calculation
 */
export const calculateFeeIteratively = (
  inputUtxos: ReadonlyArray<UTxO.UTxO>,
  inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  outputs: ReadonlyArray<UTxO.TxOutput>,
  protocolParams: {
    minFeeCoefficient: bigint
    minFeeConstant: bigint
  }
): Effect.Effect<bigint, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Build fake witness set once for accurate size estimation
    const fakeWitnessSet = yield* buildFakeWitnessSet(inputUtxos)
    
    // Convert SDK TxOutput outputs to core TransactionOutputs once
    const transactionOutputs: Array<TransactionOutput.TransactionOutput> = yield* Effect.all(
      outputs.map((output) =>
        txOutputToTransactionOutput({
          address: output.address,
          assets: output.assets,
          datum: output.datumOption,
          scriptRef: output.scriptRef
        })
      )
    )
    
    let currentFee = 0n
    let previousSize = 0
    let previousFee = 0n
    let iterations = 0
    const maxIterations = 10  // Increase to ensure convergence
    
    while (iterations < maxIterations) {
      // Build transaction with current fee estimate
      const body = new TransactionBody.TransactionBody({
        inputs: inputs as Array<TransactionInput.TransactionInput>,
        outputs: transactionOutputs,
        fee: currentFee
      })
      
      const transaction = new Transaction.Transaction({
        body,
        witnessSet: fakeWitnessSet,  // Use fake witness set for accurate size
        isValid: true,
        auxiliaryData: null
      })
      
      // Calculate size
      const size = yield* calculateTransactionSize(transaction)
      
      // Calculate fee based on size
      const calculatedFee = calculateMinimumFee(size, {
        minFeeCoefficient: protocolParams.minFeeCoefficient,
        minFeeConstant: protocolParams.minFeeConstant
      })
      
      // Check if fully converged: fee is stable AND size is stable
      if (currentFee === previousFee && size === previousSize && currentFee >= calculatedFee) {
        if (iterations > 1) {
          yield* Effect.logDebug(
            `Fee converged after ${iterations} iterations: ${currentFee} lovelace (tx size: ${size} bytes)`
          )
        }
        return currentFee
      }
      
      // Update for next iteration
      previousFee = currentFee
      currentFee = calculatedFee
      previousSize = size
      iterations++
    }
    
    // Didn't converge within max iterations - return the calculated fee
    yield* Effect.logDebug(
      `Fee calculation reached max iterations (${maxIterations}): ${currentFee} lovelace`
    )
    return currentFee
  }).pipe(
    Effect.mapError(
      (error) =>
        new TransactionBuilderError({
          message: "Fee calculation failed to converge",
          cause: error
        })
    )
  )

// ============================================================================
// Balance Verification for Re-selection Loop
// ============================================================================

/**
 * Verify if selected UTxOs can cover outputs + fee for ALL assets.
 * Used by the re-selection loop to determine if more UTxOs are needed.
 * 
 * Checks both lovelace AND native assets (tokens/NFTs) to ensure complete balance.
 * 
 * @param selectedUtxos - Currently selected input UTxOs
 * @param outputs - Required transaction outputs
 * @param fee - Calculated transaction fee (lovelace only)
 * @returns Balance status with shortfall and change amounts
 * 
 * @since 2.0.0
 * @category fee-calculation
 */
export const verifyTransactionBalance = (
  selectedUtxos: ReadonlyArray<UTxO.UTxO>,
  outputs: ReadonlyArray<UTxO.TxOutput>,
  fee: bigint
): { sufficient: boolean; shortfall: bigint; change: bigint } => {
  // Sum all input assets
  const totalInputAssets = selectedUtxos.reduce(
    (acc, utxo) => Assets.add(acc, utxo.assets),
    Assets.empty()
  )
  
  // Sum all output assets
  const totalOutputAssets = outputs.reduce(
    (acc, output) => Assets.add(acc, output.assets),
    Assets.empty()
  )
  
  // Add fee to required lovelace
  const requiredAssets = Assets.add(
    totalOutputAssets,
    Assets.fromLovelace(fee)
  )
  
  // Calculate balance for ALL assets: inputs - (outputs + fee)
  const balance = Assets.subtract(totalInputAssets, requiredAssets)
  
  // Check if ANY asset is negative (insufficient)
  let hasShortfall = false
  let lovelaceShortfall = 0n
  
  // Check lovelace
  const balanceLovelace = Assets.getAsset(balance, "lovelace")
  if (balanceLovelace < 0n) {
    hasShortfall = true
    lovelaceShortfall = -balanceLovelace
  }
  
  // Check all native assets
  for (const [unit, amount] of Object.entries(balance)) {
    if (unit !== "lovelace" && amount < 0n) {
      hasShortfall = true
      // For native asset shortfalls, we still return lovelace shortfall
      // since coin selection will need to find UTxOs with both lovelace AND the missing asset
      // Add some lovelace buffer to encourage selection of UTxOs with native assets
      lovelaceShortfall = lovelaceShortfall > 0n ? lovelaceShortfall : 100_000n
      break
    }
  }
  
  return {
    sufficient: !hasShortfall,
    shortfall: lovelaceShortfall,
    change: balanceLovelace > 0n ? balanceLovelace : 0n
  }
}

// ============================================================================
// Balance Validation
// ============================================================================

/**
 * Validate that inputs cover outputs plus fee.
 * This is the ONLY validation for minimal build - no coin selection.
 * 
 * @since 2.0.0
 * @category validation
 */
export const validateTransactionBalance = (params: {
  totalInputAssets: Assets.Assets
  totalOutputAssets: Assets.Assets
  fee: bigint
}): Effect.Effect<void, TransactionBuilderError> =>
  Effect.gen(function* () {
    const { fee, totalInputAssets, totalOutputAssets } = params
    
    // Calculate total outputs including fee (outputs + fee)
    const totalRequired = Assets.add(
      totalOutputAssets,
      Assets.fromLovelace(fee)
    )
    
    // Check each asset using Assets.getUnits and Assets.getAsset helpers
    for (const unit of Assets.getUnits(totalRequired)) {
      const requiredAmount = Assets.getAsset(totalRequired, unit)
      const availableAmount = Assets.getAsset(totalInputAssets, unit)
      
      if (availableAmount < requiredAmount) {
        const shortfall = requiredAmount - availableAmount
        
        return yield* Effect.fail(
          new TransactionBuilderError({
            message: `Insufficient ${unit}: need ${requiredAmount}, have ${availableAmount} (short by ${shortfall})`,
            cause: {
              unit,
              required: String(requiredAmount),
              available: String(availableAmount),
              shortfall: String(shortfall)
            }
          })
        )
      }
    }
    
    // All assets covered
  })

/**
 * Calculate leftover assets (will become excess fee in minimal build).
 * 
 * @since 2.0.0
 * @category validation
 */
export const calculateLeftoverAssets = (params: {
  totalInputAssets: Assets.Assets
  totalOutputAssets: Assets.Assets
  fee: bigint
}): Assets.Assets => {
  const { fee, totalInputAssets, totalOutputAssets } = params
  
  // Start with inputs, subtract outputs and fee using Assets helpers
  const afterOutputs = Assets.subtract(totalInputAssets, totalOutputAssets)
  const leftover = Assets.subtract(afterOutputs, Assets.fromLovelace(fee))
  
  // Filter out zero or negative amounts
  return Assets.filter(leftover, (_unit, amount) => amount > 0n)
}

/**
 * Calculate minimum ADA required for a UTxO based on its actual CBOR size.
 * Uses the Babbage-era formula: coinsPerUtxoByte * utxoSize.
 * 
 * This function creates a temporary TransactionOutput, encodes it to CBOR,
 * and calculates the exact size to determine the minimum lovelace required.
 * 
 * @since 2.0.0
 * @category change
 */
export const calculateMinimumUtxoLovelace = (params: {
  address: string
  assets: Assets.Assets
  datum?: Datum.Datum
  scriptRef?: any
  coinsPerUtxoByte: bigint
}): Effect.Effect<bigint, TransactionBuilderError> =>
  Effect.gen(function* () {
    // Create a temporary TransactionOutput to calculate its CBOR size
    const tempOutput = yield* txOutputToTransactionOutput({
      address: params.address,
      assets: params.assets,
      datum: params.datum,
      scriptRef: params.scriptRef
    })
    
    // Encode to CBOR bytes to get the actual size
    const cborBytes = yield* Effect.try({
      try: () => TransactionOutput.toCBORBytes(tempOutput),
      catch: (error) =>
        new TransactionBuilderError({
          message: "Failed to encode output to CBOR for min UTxO calculation",
          cause: error
        })
    })
    
    // Calculate minimum lovelace: coinsPerUtxoByte * size
    return params.coinsPerUtxoByte * BigInt(cborBytes.length)
  })

/**
 * Create change output(s) for leftover assets.
 * 
 * When unfracking is disabled (default):
 * 1. Check if leftover assets exist
 * 2. Calculate minimum ADA required for change output
 * 3. If leftover lovelace < minimum, cannot create change (warning)
 * 4. Create single output with all leftover assets to change address
 * 
 * When unfracking is enabled:
 * 1. Apply Unfrack.It optimization strategies
 * 2. Bundle tokens into optimally-sized UTxOs
 * 3. Isolate fungible tokens if configured
 * 4. Group NFTs by policy if configured
 * 5. Roll up or subdivide ADA-only UTxOs
 * 6. Return multiple change outputs for optimal wallet structure
 * 
 * @since 2.0.0
 * @category change
 */
export const createChangeOutput = (params: {
  leftoverAssets: Assets.Assets
  changeAddress: string
  coinsPerUtxoByte: bigint
  unfrackOptions?: UnfrackOptions
}): Effect.Effect<ReadonlyArray<UTxO.TxOutput>, TransactionBuilderError> =>
  Effect.gen(function* () {
    const { changeAddress, coinsPerUtxoByte, leftoverAssets, unfrackOptions } = params
    
    // If no leftover, no change needed
    if (Assets.isEmpty(leftoverAssets)) {
      yield* Effect.logDebug(`[createChangeOutput] No leftover assets, skipping change`)
      return []
    }
    
    // If unfracking is enabled, use Unfrack module
    if (unfrackOptions) {
      const unfrackedOutputs = yield* Unfrack.createUnfrackedChangeOutputs(
        changeAddress,
        leftoverAssets,
        unfrackOptions,
        coinsPerUtxoByte,
      ).pipe(
        Effect.mapError((error) => 
          new TransactionBuilderError({
            message: `Failed to create unfracked change outputs: ${error.message}`,
            cause: error
          })
        )
      )
      
      yield* Effect.logDebug(`[createChangeOutput] Created ${unfrackedOutputs.length} unfracked change outputs`)
      return unfrackedOutputs
    }
    
    // Default behavior: single change output using accurate CBOR-based calculation
    // Calculate minimum UTxO using actual CBOR encoding size
    const minLovelace = yield* calculateMinimumUtxoLovelace({
      address: changeAddress,
      assets: leftoverAssets,
      coinsPerUtxoByte
    })
    
    // Check if we have enough lovelace for change
    const leftoverLovelace = Assets.getAsset(leftoverAssets, "lovelace")
    
    yield* Effect.logDebug(
      `[createChangeOutput] Leftover: ${leftoverLovelace} lovelace, MinUTxO: ${minLovelace} lovelace`
    )
    
    if (leftoverLovelace < minLovelace) {
      // Not enough lovelace to create valid change output
      // This is not an error - just means leftover becomes extra fee
      yield* Effect.logDebug(`[createChangeOutput] Insufficient lovelace for change (${leftoverLovelace} < ${minLovelace}), returning empty`)
      return []
    }
    
    // Create change output using SDK UTxO output creation
    const changeOutput = yield* makeTxOutput({
      address: changeAddress,
      assets: leftoverAssets
    })
    
    yield* Effect.logDebug(`[createChangeOutput] Created 1 change output with ${leftoverLovelace} lovelace`)
    
    return [changeOutput]
  })
