---
title: sdk/builders/TxBuilderImpl.ts
nav_order: 131
parent: Modules
---

## TxBuilderImpl overview

// Effect-TS imports

---

<h2 class="text-delta">Table of contents</h2>

- [assembly](#assembly)
  - [assembleTransaction](#assembletransaction)
  - [buildTransactionInputs](#buildtransactioninputs)
- [change](#change)
  - [calculateMinimumUtxoLovelace](#calculateminimumutxolovelace)
  - [createChangeOutput](#createchangeoutput)
- [fee-calculation](#fee-calculation)
  - [buildFakeWitnessSet](#buildfakewitnessset)
  - [calculateFeeIteratively](#calculatefeeiteratively)
  - [calculateMinimumFee](#calculateminimumfee)
  - [calculateTransactionSize](#calculatetransactionsize)
  - [verifyTransactionBalance](#verifytransactionbalance)
- [helpers](#helpers)
  - [calculateTotalAssets](#calculatetotalassets)
  - [filterScriptUtxos](#filterscriptutxos)
  - [isScriptAddress](#isscriptaddress)
  - [makeDatumOption](#makedatumoption)
  - [makeTxOutput](#maketxoutput)
  - [~~mergeAssetsIntoOutput~~](#mergeassetsintooutput)
  - [mergeAssetsIntoUTxO](#mergeassetsintoutxo)
- [programs](#programs)
  - [createCollectFromProgram](#createcollectfromprogram)
  - [createPayToAddressProgram](#createpaytoaddressprogram)
- [validation](#validation)
  - [calculateLeftoverAssets](#calculateleftoverassets)
  - [validateTransactionBalance](#validatetransactionbalance)

---

# assembly

## assembleTransaction

Assemble a Transaction from inputs, outputs, and calculated fee.
Creates TransactionBody with all required fields.

This is where SDK UTxO outputs are converted to core TransactionOutputs.

This is minimal assembly with accurate fee:

- Build witness set with redeemers and signatures (Step 4 - future)
- Run script evaluation to fill ExUnits (Step 5 - future)
- Add change output (Step 6 - future)

**Signature**

```ts
export declare const assembleTransaction: (
  inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  outputs: ReadonlyArray<UTxO.TxOutput>,
  fee: bigint
) => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
```

Added in v2.0.0

## buildTransactionInputs

Convert an array of UTxOs to an array of TransactionInputs.
Inputs are sorted by txHash then outputIndex for deterministic ordering.
Converts SDK types (UTxO.UTxO) to core types (TransactionInput).

**Signature**

```ts
export declare const buildTransactionInputs: (
  utxos: ReadonlyArray<UTxO.UTxO>
) => Effect.Effect<ReadonlyArray<TransactionInput.TransactionInput>, TransactionBuilderError>
```

Added in v2.0.0

# change

## calculateMinimumUtxoLovelace

Calculate minimum ADA required for a UTxO based on its actual CBOR size.
Uses the Babbage-era formula: coinsPerUtxoByte \* utxoSize.

This function creates a temporary TransactionOutput, encodes it to CBOR,
and calculates the exact size to determine the minimum lovelace required.

**Signature**

```ts
export declare const calculateMinimumUtxoLovelace: (params: {
  address: string
  assets: Assets.Assets
  datum?: Datum.Datum
  scriptRef?: any
  coinsPerUtxoByte: bigint
}) => Effect.Effect<bigint, TransactionBuilderError>
```

Added in v2.0.0

## createChangeOutput

Create change output(s) for leftover assets.

When unfracking is disabled (default):

1. Check if leftover assets exist
2. Calculate minimum ADA required for change output
3. If leftover lovelace < minimum, cannot create change (warning)
4. Create single output with all leftover assets to change address

When unfracking is enabled:

1. Apply Unfrack.It optimization strategies
2. Bundle tokens into optimally-sized UTxOs
3. Isolate fungible tokens if configured
4. Group NFTs by policy if configured
5. Roll up or subdivide ADA-only UTxOs
6. Return multiple change outputs for optimal wallet structure

**Signature**

```ts
export declare const createChangeOutput: (params: {
  leftoverAssets: Assets.Assets
  changeAddress: string
  coinsPerUtxoByte: bigint
  unfrackOptions?: UnfrackOptions
}) => Effect.Effect<ReadonlyArray<UTxO.TxOutput>, TransactionBuilderError>
```

Added in v2.0.0

# fee-calculation

## buildFakeWitnessSet

Build a fake witness set for fee estimation from transaction inputs.
Extracts unique payment key hashes from input addresses and creates
fake witnesses to accurately estimate witness set size in CBOR.

**Signature**

```ts
export declare const buildFakeWitnessSet: (
  inputUtxos: ReadonlyArray<UTxO.UTxO>
) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
```

Added in v2.0.0

## calculateFeeIteratively

Calculate transaction fee iteratively until stable.

Algorithm:

1. Build fake witness set from input UTxOs for accurate size estimation
2. Build transaction with fee = 0
3. Calculate size and fee
4. Rebuild transaction with calculated fee
5. If size changed, recalculate (usually converges in 1-2 iterations)

**Signature**

```ts
export declare const calculateFeeIteratively: (
  inputUtxos: ReadonlyArray<UTxO.UTxO>,
  inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  outputs: ReadonlyArray<UTxO.TxOutput>,
  protocolParams: { minFeeCoefficient: bigint; minFeeConstant: bigint }
) => Effect.Effect<bigint, TransactionBuilderError>
```

Added in v2.0.0

## calculateMinimumFee

Calculate minimum transaction fee based on protocol parameters.

Formula: minFee = txSizeInBytes × minFeeCoefficient + minFeeConstant

**Signature**

```ts
export declare const calculateMinimumFee: (
  transactionSizeBytes: number,
  protocolParams: { minFeeCoefficient: bigint; minFeeConstant: bigint }
) => bigint
```

Added in v2.0.0

## calculateTransactionSize

Calculate the size of a transaction in bytes for fee estimation.
Uses CBOR serialization to get accurate size.

**Signature**

```ts
export declare const calculateTransactionSize: (
  transaction: Transaction.Transaction
) => Effect.Effect<number, TransactionBuilderError>
```

Added in v2.0.0

## verifyTransactionBalance

Verify if selected UTxOs can cover outputs + fee for ALL assets.
Used by the re-selection loop to determine if more UTxOs are needed.

Checks both lovelace AND native assets (tokens/NFTs) to ensure complete balance.

**Signature**

```ts
export declare const verifyTransactionBalance: (
  selectedUtxos: ReadonlyArray<UTxO.UTxO>,
  outputs: ReadonlyArray<UTxO.TxOutput>,
  fee: bigint
) => { sufficient: boolean; shortfall: bigint; change: bigint }
```

Added in v2.0.0

# helpers

## calculateTotalAssets

Calculate total assets from a set of UTxOs.

**Signature**

```ts
export declare const calculateTotalAssets: (utxos: ReadonlyArray<UTxO.UTxO> | Set<UTxO.UTxO>) => Assets.Assets
```

Added in v2.0.0

## filterScriptUtxos

Filter UTxOs to find those locked by scripts (script-locked UTxOs).

**Signature**

```ts
export declare const filterScriptUtxos: (
  utxos: ReadonlyArray<UTxO.UTxO>
) => Effect.Effect<ReadonlyArray<UTxO.UTxO>, TransactionBuilderError>
```

Added in v2.0.0

## isScriptAddress

Check if an address is a script address (payment credential is ScriptHash).
Parses the address to extract its structure and checks the payment credential type.

**Signature**

```ts
export declare const isScriptAddress: (address: string) => Effect.Effect<boolean, TransactionBuilderError>
```

Added in v2.0.0

## makeDatumOption

Convert SDK Datum to core DatumOption.
Parses CBOR hex strings for inline datums and hashes for datum references.

**Signature**

```ts
export declare const makeDatumOption: (
  datum: Datum.Datum
) => Effect.Effect<DatumOption.DatumOption, TransactionBuilderError>
```

Added in v2.0.0

## makeTxOutput

Create a TxOutput from user-friendly parameters.
Stays in SDK types for easier manipulation (merging, etc).

TxOutput represents an output being created in a transaction - it doesn't have
txHash/outputIndex yet since the transaction hasn't been submitted.

**Signature**

```ts
export declare const makeTxOutput: (params: {
  address: string
  assets: Assets.Assets
  datum?: Datum.Datum
  scriptRef?: any
}) => Effect.Effect<UTxO.TxOutput, TransactionBuilderError>
```

Added in v2.0.0

## ~~mergeAssetsIntoOutput~~

Merge additional assets into an existing TransactionOutput.
Creates a new output with combined assets from the original output and leftover assets.

Use case: Draining wallet by merging leftover into an existing payment output.

**Signature**

```ts
export declare const mergeAssetsIntoOutput: (
  output: TransactionOutput.TransactionOutput,
  additionalAssets: Assets.Assets
) => Effect.Effect<TransactionOutput.TransactionOutput, TransactionBuilderError>
```

Added in v2.0.0

## mergeAssetsIntoUTxO

Merge additional assets into an existing UTxO (output).
Creates a new UTxO with combined assets from the original UTxO and additional assets.

Use case: Draining wallet by merging leftover into an existing payment output.

**Signature**

```ts
export declare const mergeAssetsIntoUTxO: (
  utxo: UTxO.UTxO,
  additionalAssets: Assets.Assets
) => Effect.Effect<UTxO.UTxO, TransactionBuilderError>
```

Added in v2.0.0

# programs

## createCollectFromProgram

Creates a ProgramStep for collectFrom operation.
Adds UTxOs as transaction inputs, validates script requirements, and tracks assets.

Implementation:

1. Validates that inputs array is not empty
2. Checks if any inputs are script-locked (require redeemers)
3. Validates redeemer is provided for script-locked UTxOs
4. Adds UTxOs to state.selectedUtxos
5. Tracks redeemer information for script spending
6. Updates total input assets for balancing

**Signature**

```ts
export declare const createCollectFromProgram: (
  params: CollectFromParams
) => Effect.Effect<undefined, TransactionBuilderError, TxContext>
```

Added in v2.0.0

## createPayToAddressProgram

Creates a ProgramStep for payToAddress operation.
Creates a UTxO output and tracks assets for balancing.

Implementation:

1. Creates UTxO output from parameters using helper
2. Adds output to state.outputs array
3. Updates totalOutputAssets for balancing

**Signature**

```ts
export declare const createPayToAddressProgram: (
  params: PayToAddressParams
) => Effect.Effect<void, TransactionBuilderError, TxContext>
```

Added in v2.0.0

# validation

## calculateLeftoverAssets

Calculate leftover assets (will become excess fee in minimal build).

**Signature**

```ts
export declare const calculateLeftoverAssets: (params: {
  totalInputAssets: Assets.Assets
  totalOutputAssets: Assets.Assets
  fee: bigint
}) => Assets.Assets
```

Added in v2.0.0

## validateTransactionBalance

Validate that inputs cover outputs plus fee.
This is the ONLY validation for minimal build - no coin selection.

**Signature**

```ts
export declare const validateTransactionBalance: (params: {
  totalInputAssets: Assets.Assets
  totalOutputAssets: Assets.Assets
  fee: bigint
}) => Effect.Effect<void, TransactionBuilderError>
```

Added in v2.0.0
