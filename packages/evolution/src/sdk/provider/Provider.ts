import type { Effect } from "effect"
import { Context, Data } from "effect"

import type * as Address from "../Address.js"
import type * as Credential from "../Credential.js"
import type * as Delegation from "../Delegation.js"
import type { EvalRedeemer } from "../EvalRedeemer.js"
import type * as OutRef from "../OutRef.js"
import type * as ProtocolParameters from "../ProtocolParameters.js"
import type * as RewardAddress from "../RewardAddress.js"
import type { UTxO } from "../UTxO.js"

// Base Provider Error
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly cause: unknown
  readonly message: string
}> {}

// Type helper to convert Effect types to Promise types
type EffectToPromise<T> = T extends Effect.Effect<infer Return, infer _Error, infer _Context>
  ? Promise<Return>
  : T extends (...args: Array<any>) => Effect.Effect<infer Return, infer _Error, infer _Context>
  ? (...args: Parameters<T>) => Promise<Return>
  : never

type EffectToPromiseAPI<T> = {
  [K in keyof T]: EffectToPromise<T[K]>
}

// Effect-based Provider interface (the source of truth)
export interface ProviderEffect {
  readonly getProtocolParameters: Effect.Effect<ProtocolParameters.ProtocolParameters, ProviderError>
  getUtxos: (addressOrCredential: Address.Address | Credential.Credential) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxosWithUnit: (addressOrCredential: Address.Address | Credential.Credential, unit: string) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxoByUnit: (unit: string) => Effect.Effect<UTxO, ProviderError>
  readonly getUtxosByOutRef: (outRefs: ReadonlyArray<OutRef.OutRef>) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Effect.Effect<Delegation.Delegation, ProviderError>
  readonly getDatum: (datumHash: string) => Effect.Effect<string, ProviderError>
  readonly awaitTx: (txHash: string, checkInterval?: number) => Effect.Effect<boolean, ProviderError>
  readonly submitTx: (cbor: string) => Effect.Effect<string, ProviderError>
  readonly evaluateTx: (tx: string, additionalUTxOs?: Array<UTxO>) => Effect.Effect<Array<EvalRedeemer>, ProviderError>
}

export const ProviderEffect: Context.Tag<ProviderEffect, ProviderEffect> =
  Context.GenericTag<ProviderEffect>("@evolution/ProviderService")

// Promise-based Provider interface (auto-generated from Effect interface)
export interface Provider extends EffectToPromiseAPI<ProviderEffect> {
  // Effect namespace for Effect-based alternatives
  readonly Effect: ProviderEffect
}