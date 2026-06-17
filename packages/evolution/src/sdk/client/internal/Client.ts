import { Effect } from "effect"

import { runEffectPromise } from "../../../EffectRuntime.js"
import {
  makeTxBuilder,
  type ReadOnlyTransactionBuilder,
  type SigningTransactionBuilder
} from "../../builders/TransactionBuilder.js"
import * as Provider from "../../provider/Provider.js"
import type * as Wallet from "../../wallet/Wallet.js"
import { type Chain, mainnet } from "../Chain.js"
import type {
  AddressClient,
  AddressClientEffect,
  ClientAssembly,
  OfflineSignerClient,
  OfflineSignerClientEffect,
  ReadClient,
  ReadOnlyClient,
  ReadOnlyClientEffect,
  SigningClient,
  SigningClientEffect
} from "../Client.js"
import * as Providers from "./Providers.js"
import * as Signing from "./Signing.js"
import * as Wallets from "./Wallets.js"

const createAddressClient = (chain: Chain, wallet: Wallet.ReadOnlyWallet): AddressClient => ({
  address: wallet.address,
  rewardAddress: wallet.rewardAddress,
  chain,
  withBlockfrost: (config) => createReadOnlyClient(chain, Providers.blockfrost(config), wallet),
  withKoios: (config) => createReadOnlyClient(chain, Providers.koios(config), wallet),
  withKupmios: (config) => createReadOnlyClient(chain, Providers.kupmios(config), wallet),
  withMaestro: (config) => createReadOnlyClient(chain, Providers.maestro(config), wallet),
  effect: wallet.effect satisfies AddressClientEffect
})

const createOfflineSignerEffect = (wallet: Signing.ResolvedSignerWallet): OfflineSignerClientEffect => ({
  address: wallet.effect.address.bind(wallet.effect),
  rewardAddress: wallet.effect.rewardAddress.bind(wallet.effect),
  signTx: (txOrHex, context) => Signing.signWithWallet(wallet, txOrHex, context),
  signTxs: (txs, context) => Signing.signTxsWithWallet(wallet, txs, context),
  signMessage: wallet.effect.signMessage.bind(wallet.effect)
})

const createOfflineSignerClient = (chain: Chain, wallet: Signing.ResolvedSignerWallet): OfflineSignerClient => {
  const effectInterface = createOfflineSignerEffect(wallet)

  return {
    address: () => runEffectPromise(effectInterface.address()),
    rewardAddress: () => runEffectPromise(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effectInterface.signTx(txOrHex, context)),
    signTxs: (txs, context) => runEffectPromise(effectInterface.signTxs(txs, context)),
    signMessage: (address, payload) => runEffectPromise(effectInterface.signMessage(address, payload)),
    chain,
    withBlockfrost: (config) => createSigningClient(chain, Providers.blockfrost(config), wallet),
    withKoios: (config) => createSigningClient(chain, Providers.koios(config), wallet),
    withKupmios: (config) => createSigningClient(chain, Providers.kupmios(config), wallet),
    withMaestro: (config) => createSigningClient(chain, Providers.maestro(config), wallet),
    effect: effectInterface
  }
}

const createReadOnlyClient = (
  chain: Chain,
  provider: Provider.Provider,
  wallet: Wallet.ReadOnlyWallet
): ReadOnlyClient => {
  const effectInterface: ReadOnlyClientEffect = {
    ...provider.effect,
    ...wallet.effect,
    getWalletUtxos: () => wallet.effect.address().pipe(Effect.flatMap((address) => provider.effect.getUtxos(address))),
    getWalletDelegation: () =>
      wallet.effect.rewardAddress().pipe(
        Effect.flatMap((rewardAddress) => {
          if (!rewardAddress) {
            return Effect.fail(new Provider.ProviderError({ message: "No reward address configured" }))
          }

          return provider.effect.getDelegation(rewardAddress)
        })
      )
  }

  return {
    ...provider,
    address: wallet.address,
    rewardAddress: wallet.rewardAddress,
    getWalletUtxos: () => runEffectPromise(effectInterface.getWalletUtxos()),
    getWalletDelegation: () => runEffectPromise(effectInterface.getWalletDelegation()),
    chain,
    newTx: (): ReadOnlyTransactionBuilder => makeTxBuilder({ wallet, provider, chain }),
    effect: effectInterface
  }
}

const createSigningClient = (
  chain: Chain,
  provider: Provider.Provider,
  wallet: Signing.ResolvedSignerWallet
): SigningClient => {
  const effectInterface: SigningClientEffect = {
    ...provider.effect,
    address: wallet.effect.address,
    rewardAddress: wallet.effect.rewardAddress,
    signMessage: wallet.effect.signMessage,
    signTx: (txOrHex, context) => Signing.signWithAutoFetch(provider, wallet, txOrHex, context),
    signTxs: (txs, context) => Signing.signTxsWithAutoFetch(provider, wallet, txs, context),
    getWalletUtxos: () => Effect.flatMap(wallet.effect.address(), (address) => provider.effect.getUtxos(address)),
    getWalletDelegation: () =>
      Effect.flatMap(wallet.effect.rewardAddress(), (rewardAddress) => {
        if (!rewardAddress) {
          return Effect.fail(new Provider.ProviderError({ message: "No reward address configured" }))
        }

        return provider.effect.getDelegation(rewardAddress)
      })
  }

  return {
    ...provider,
    address: () => runEffectPromise(effectInterface.address()),
    rewardAddress: () => runEffectPromise(effectInterface.rewardAddress()),
    signMessage: (address, payload) => runEffectPromise(effectInterface.signMessage(address, payload)),
    signTx: (txOrHex, context) => runEffectPromise(effectInterface.signTx(txOrHex, context)),
    signTxs: (txs, context) => runEffectPromise(effectInterface.signTxs(txs, context)),
    getWalletUtxos: () => runEffectPromise(effectInterface.getWalletUtxos()),
    getWalletDelegation: () => runEffectPromise(effectInterface.getWalletDelegation()),
    chain,
    newTx: (): SigningTransactionBuilder => makeTxBuilder({ wallet, provider, chain }),
    effect: effectInterface
  }
}

const createReadClient = (chain: Chain, provider: Provider.Provider): ReadClient => ({
  ...provider,
  chain,
  withAddress: (address, rewardAddress) => createReadOnlyClient(chain, provider, Wallets.readOnlyWallet(address, rewardAddress)(chain)),
  withSeed: (config) => createSigningClient(chain, provider, Wallets.seedWallet(config)(chain)),
  withPrivateKey: (config) => createSigningClient(chain, provider, Wallets.privateKeyWallet(config)(chain)),
  withCip30: (api) => createSigningClient(chain, provider, Wallets.cip30Wallet(api)(chain)),
  newTx: (): ReadOnlyTransactionBuilder => makeTxBuilder({ provider, chain }),
  effect: provider.effect
})

export const client = (chain: Chain = mainnet): ClientAssembly => ({
  chain,
  withBlockfrost: (config) => createReadClient(chain, Providers.blockfrost(config)),
  withKoios: (config) => createReadClient(chain, Providers.koios(config)),
  withKupmios: (config) => createReadClient(chain, Providers.kupmios(config)),
  withMaestro: (config) => createReadClient(chain, Providers.maestro(config)),
  withAddress: (address, rewardAddress) => createAddressClient(chain, Wallets.readOnlyWallet(address, rewardAddress)(chain)),
  withSeed: (config) => createOfflineSignerClient(chain, Wallets.seedWallet(config)(chain)),
  withPrivateKey: (config) => createOfflineSignerClient(chain, Wallets.privateKeyWallet(config)(chain)),
  withCip30: (api) => createOfflineSignerClient(chain, Wallets.cip30Wallet(api)(chain))
})