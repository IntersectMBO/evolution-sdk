import { Effect, Layer, Logger, LogLevel } from "effect"

import * as EffectRuntime from "../../../EffectRuntime.js"
import type * as CoreScript from "../../../Script.js"
import * as AddSigner from "../operations/AddSigner.js"
import * as Attach from "../operations/Attach.js"
import * as AttachMetadata from "../operations/AttachMetadata.js"
import * as Collect from "../operations/Collect.js"
import * as Governance from "../operations/Governance.js"
import * as Mint from "../operations/Mint.js"
import type * as Operations from "../operations/Operations.js"
import * as Pay from "../operations/Pay.js"
import * as Pool from "../operations/Pool.js"
import * as Propose from "../operations/Propose.js"
import * as ReadFrom from "../operations/ReadFrom.js"
import * as SendAll from "../operations/SendAll.js"
import * as Stake from "../operations/Stake.js"
import * as Validity from "../operations/Validity.js"
import * as Vote from "../operations/Vote.js"
import type * as Builder from "../TransactionBuilder.js"
import * as BuilderBuild from "./build.js"

const debugLayer = Layer.merge(Logger.pretty, Logger.minimumLogLevel(LogLevel.Debug))

const withDebugLogging = <A, E>(effect: Effect.Effect<A, E>, debug?: boolean) =>
  debug ? effect.pipe(Effect.provide(debugLayer)) : effect

export const makeTxBuilder = (
  config: Builder.TxBuilderConfig
): Builder.SigningTransactionBuilder | Builder.ReadOnlyTransactionBuilder => {
  const programs: Array<Builder.ProgramStep> = []

  const txBuilder = {
    payToAddress: (params: Operations.PayToAddressParams) => {
      programs.push(Pay.createPayToAddressProgram(params))
      return txBuilder
    },

    collectFrom: (params: Operations.CollectFromParams) => {
      programs.push(Collect.createCollectFromProgram(params))
      return txBuilder
    },

    sendAll: (params: Operations.SendAllParams) => {
      programs.push(SendAll.createSendAllProgram(params))
      return txBuilder
    },

    mintAssets: (params: Operations.MintTokensParams) => {
      programs.push(Mint.createMintAssetsProgram(params))
      return txBuilder
    },

    readFrom: (params: Operations.ReadFromParams) => {
      programs.push(ReadFrom.createReadFromProgram(params))
      return txBuilder
    },

    attachScript: (params: { script: CoreScript.Script }) => {
      programs.push(Attach.attachScriptToState(params.script))
      return txBuilder
    },

    registerStake: (params: Operations.RegisterStakeParams) => {
      programs.push(Stake.createRegisterStakeProgram(params))
      return txBuilder
    },
    registerStakeLegacy: (params: Operations.RegisterStakeLegacyParams) => {
      programs.push(Stake.createRegisterStakeLegacyProgram(params))
      return txBuilder
    },
    deregisterStake: (params: Operations.DeregisterStakeParams) => {
      programs.push(Stake.createDeregisterStakeProgram(params))
      return txBuilder
    },
    deregisterStakeLegacy: (params: Operations.DeregisterStakeLegacyParams) => {
      programs.push(Stake.createDeregisterStakeLegacyProgram(params))
      return txBuilder
    },
    delegateTo: (params: Operations.DelegateToParams) => {
      programs.push(Stake.createDelegateToProgram(params))
      return txBuilder
    },
    delegateToPool: (params: Operations.DelegateToPoolParams) => {
      programs.push(Stake.createDelegateToPoolProgram(params))
      return txBuilder
    },
    delegateToDRep: (params: Operations.DelegateToDRepParams) => {
      programs.push(Stake.createDelegateToDRepProgram(params))
      return txBuilder
    },
    delegateToPoolAndDRep: (params: Operations.DelegateToPoolAndDRepParams) => {
      programs.push(Stake.createDelegateToPoolAndDRepProgram(params))
      return txBuilder
    },
    withdraw: (params: Operations.WithdrawParams) => {
      programs.push(Stake.createWithdrawProgram(params))
      return txBuilder
    },
    registerAndDelegateTo: (params: Operations.RegisterAndDelegateToParams) => {
      programs.push(Stake.createRegisterAndDelegateToProgram(params))
      return txBuilder
    },
    registerDRep: (params: Operations.RegisterDRepParams) => {
      programs.push(Governance.createRegisterDRepProgram(params))
      return txBuilder
    },
    updateDRep: (params: Operations.UpdateDRepParams) => {
      programs.push(Governance.createUpdateDRepProgram(params))
      return txBuilder
    },
    deregisterDRep: (params: Operations.DeregisterDRepParams) => {
      programs.push(Governance.createDeregisterDRepProgram(params))
      return txBuilder
    },
    authCommitteeHot: (params: Operations.AuthCommitteeHotParams) => {
      programs.push(Governance.createAuthCommitteeHotProgram(params))
      return txBuilder
    },
    resignCommitteeCold: (params: Operations.ResignCommitteeColdParams) => {
      programs.push(Governance.createResignCommitteeColdProgram(params))
      return txBuilder
    },
    registerPool: (params: Operations.RegisterPoolParams) => {
      programs.push(Pool.createRegisterPoolProgram(params))
      return txBuilder
    },
    retirePool: (params: Operations.RetirePoolParams) => {
      programs.push(Pool.createRetirePoolProgram(params))
      return txBuilder
    },
    setValidity: (params: Operations.ValidityParams) => {
      programs.push(Validity.createSetValidityProgram(params))
      return txBuilder
    },
    vote: (params: Operations.VoteParams) => {
      programs.push(Vote.createVoteProgram(params))
      return txBuilder
    },
    propose: (params: Operations.ProposeParams) => {
      programs.push(Propose.createProposeProgram(params))
      return txBuilder
    },
    addSigner: (params: Operations.AddSignerParams) => {
      programs.push(AddSigner.createAddSignerProgram(params))
      return txBuilder
    },
    attachMetadata: (params: Operations.AttachMetadataParams) => {
      programs.push(AttachMetadata.createAttachMetadataProgram(params))
      return txBuilder
    },
    compose: (other: Builder.TransactionBuilder) => {
      const otherPrograms = other.getPrograms()
      if (otherPrograms.length > 0) {
        programs.push(...otherPrograms)
      }
      return txBuilder
    },
    getPrograms: () => [...programs],
    buildEffect: (options?: Builder.BuildOptions) => BuilderBuild.makeBuild(config, programs, options),
    build: (options?: Builder.BuildOptions) =>
      EffectRuntime.runEffectPromise(withDebugLogging(BuilderBuild.makeBuild(config, programs, options), options?.debug)),
    buildEither: (options?: Builder.BuildOptions) =>
      EffectRuntime.runEffectPromise(withDebugLogging(BuilderBuild.makeBuild(config, programs, options).pipe(Effect.either), options?.debug)),
  }

  return txBuilder as Builder.SigningTransactionBuilder | Builder.ReadOnlyTransactionBuilder
}