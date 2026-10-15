import * as CBOR from "@evolution-sdk/evolution/CBOR"
import * as Redeemer from "@evolution-sdk/evolution/Redeemer"
import * as Script from "@evolution-sdk/evolution/Script"
import * as ScriptRef from "@evolution-sdk/evolution/ScriptRef"
import * as TransactionBuilder from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import type * as EvalRedeemer from "@evolution-sdk/evolution/sdk/EvalRedeemer"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionInput from "@evolution-sdk/evolution/TransactionInput"
import * as TxOut from "@evolution-sdk/evolution/TxOut"
import type * as UTxO from "@evolution-sdk/evolution/UTxO"
import { Effect, Schema } from "effect"
import { evaluator } from "scalus"

/** EvaluationContext carries no protocol version, so cost against mainnet's (van Rossem). */
const PROTOCOL_MAJOR_VERSION = 11

/** Scalus names a redeemer's purpose as the ledger CDDL does; Evolution uses lower case. */
const TAGS: Record<string, Redeemer.RedeemerTag> = {
  Spend: "spend",
  Mint: "mint",
  Cert: "cert",
  Reward: "reward",
  Voting: "vote",
  Proposing: "propose"
}

/**
 * The UTxO as CIP-30's `[input, output]` pair, which `evaluator.evaluateTx` reads directly.
 *
 * FromCDDL gives the CBOR values without a bytes round trip, so the pair is built from the
 * transaction types rather than re-encoded.
 */
const toPair = (utxo: UTxO.UTxO): Uint8Array =>
  CBOR.toCBORBytes(
    [
      Schema.encodeSync(TransactionInput.FromCDDL)(
        new TransactionInput.TransactionInput({ transactionId: utxo.transactionId, index: utxo.index })
      ),
      Schema.encodeSync(TxOut.FromCDDL)(
        new TxOut.TransactionOutput({
          address: utxo.address,
          assets: utxo.assets,
          datumOption: utxo.datumOption,
          scriptRef: utxo.scriptRef ? new ScriptRef.ScriptRef({ bytes: Script.toCBOR(utxo.scriptRef) }) : undefined
        })
      )
    ],
    CBOR.CML_DEFAULT_OPTIONS
  )

export function makeEvaluator(): TransactionBuilder.Evaluator {
  return {
    evaluate: (
      tx: Transaction.Transaction,
      additionalUtxos: ReadonlyArray<UTxO.UTxO> | undefined,
      context: TransactionBuilder.EvaluationContext
    ) =>
      Effect.try({
        try: () =>
          evaluator
            .evaluateTx(
              Transaction.toCBORBytes(tx),
              (additionalUtxos ?? []).map(toPair),
              context.slotConfig,
              {
                PlutusV1: context.costModels.PlutusV1.costs,
                PlutusV2: context.costModels.PlutusV2.costs,
                PlutusV3: context.costModels.PlutusV3.costs
              },
              PROTOCOL_MAJOR_VERSION,
              // The ledger limits a transaction's scripts together, so the evaluator does too: one
              // that does not fit fails here rather than on submission.
              { memory: context.maxTxExMem, steps: context.maxTxExSteps }
            )
            .map((redeemer): EvalRedeemer.EvalRedeemer => {
              const tag = TAGS[redeemer.tag]
              // An unknown tag is an error, not a default: a tag added upstream must not silently
              // become a spend redeemer and mis-price a different script.
              if (!tag) throw new Error(`Unknown Scalus redeemer tag "${redeemer.tag}"`)
              return {
                redeemer_tag: tag,
                redeemer_index: redeemer.index,
                ex_units: new Redeemer.ExUnits({
                  mem: BigInt(redeemer.budget.memory),
                  steps: BigInt(redeemer.budget.steps)
                })
              }
            }),
        catch: (error) =>
          new TransactionBuilder.EvaluationError({
            cause: error,
            message: error instanceof Error ? error.message : "Unknown evaluation error",
            failures: []
          })
      })
  }
}
