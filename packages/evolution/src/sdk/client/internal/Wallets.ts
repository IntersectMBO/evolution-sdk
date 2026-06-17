import { Effect, ParseResult, Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import { runEffectPromise } from "../../../EffectRuntime.js"
import * as CoreRewardAccount from "../../../RewardAccount.js"
import * as CoreRewardAddress from "../../../RewardAddress.js"
import * as Transaction from "../../../Transaction.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as TransactionWitnessSet from "../../../TransactionWitnessSet.js"
import type * as CoreUTxO from "../../../UTxO.js"
import * as Derivation from "../../wallet/Derivation.js"
import * as Wallet from "../../wallet/Wallet.js"
import type { Chain } from "../Chain.js"
import type { PrivateKeyWalletConfig, SeedWalletConfig } from "../Client.js"
import * as Signing from "./Signing.js"

const validateRewardAddressNetwork = (
  rewardAddress: CoreRewardAddress.RewardAddress | null,
  chain: Chain
): Effect.Effect<CoreRewardAddress.RewardAddress | null, Wallet.WalletError> => {
  if (rewardAddress === null) return Effect.succeed(null)

  return Effect.try({
    try: () => {
      const rewardAccount = CoreRewardAccount.fromBech32(rewardAddress)
      if (rewardAccount.networkId !== chain.id) {
        throw new Wallet.WalletError({
          message: `Reward address network mismatch: reward address is for network ${rewardAccount.networkId} but chain id is ${chain.id}`
        })
      }
      return rewardAddress
    },
    catch: (cause) =>
      cause instanceof Wallet.WalletError
        ? cause
        : new Wallet.WalletError({ message: `Invalid reward address format: ${rewardAddress}`, cause })
  })
}

const decodeReadOnlyAddress = (
  address: string,
  chain: Chain
): Effect.Effect<CoreAddress.Address, Wallet.WalletError> =>
  Effect.try({
    try: () => CoreAddress.fromBech32(address),
    catch: (cause) => new Wallet.WalletError({ message: `Invalid address format: ${address}`, cause })
  }).pipe(
    Effect.flatMap((coreAddress) => {
      const networkId = CoreAddress.getNetworkId(coreAddress)
      return networkId !== chain.id
        ? Effect.fail(
            new Wallet.WalletError({
              message: `Address network mismatch: address is for network ${networkId} but chain id is ${chain.id}`
            })
          )
        : Effect.succeed(coreAddress)
    })
  )

const decodeReadOnlyRewardAddress = (
  rewardAddress: string | undefined,
  chain: Chain
): Effect.Effect<CoreRewardAddress.RewardAddress | null, Wallet.WalletError> =>
  rewardAddress === undefined
    ? Effect.succeed(null)
    : Schema.decodeUnknown(CoreRewardAddress.RewardAddress)(rewardAddress).pipe(
        Effect.mapError(
          (cause) => new Wallet.WalletError({ message: `Invalid reward address format: ${rewardAddress}`, cause })
        ),
        Effect.flatMap((coreRewardAddress) => validateRewardAddressNetwork(coreRewardAddress, chain))
      )

// ── Constructors ──────────────────────────────────────────────────────────────

/**
 * Read-only wallet — no signing capability.
 * Chain context validates that the address network matches the configured chain.
 * Validation is deferred until wallet methods are executed so client assembly stays pure.
 *
 * @since 2.1.0
 * @category constructors
 */
export const readOnlyWallet =
  (address: string, rewardAddress?: string) =>
  (chain: Chain): Wallet.ReadOnlyWallet => {
    const addressEffect = decodeReadOnlyAddress(address, chain)
    const rewardAddressEffect = decodeReadOnlyRewardAddress(rewardAddress, chain)
    const effectInterface: Wallet.ReadOnlyWalletEffect = {
      address: () => addressEffect,
      rewardAddress: () => rewardAddressEffect
    }
    return {
      type: "read-only",
      address: () => runEffectPromise(addressEffect),
      rewardAddress: () => runEffectPromise(rewardAddressEffect),
      effect: effectInterface
    }
  }

/**
 * Seed phrase wallet — returns a chain-aware factory.
 * Chain context (networkId) is injected automatically by `client(chain).withSeed(...)`.
 *
 * @since 2.1.0
 * @category constructors
 */
export const seedWallet =
  (config: SeedWalletConfig) =>
  (chain: Chain): Wallet.SigningWallet => {
    const derivationEffect = Derivation.walletFromSeed(config.mnemonic, {
      addressType: config.addressType ?? "Base",
      accountIndex: config.accountIndex ?? 0,
      paymentIndex: config.paymentIndex ?? 0,
      stakeIndex: config.stakeIndex ?? 0,
      password: config.password,
      networkId: chain.id
    }).pipe(Effect.mapError((cause) => new Wallet.WalletError({ message: cause.message, cause })))
    return Signing.makeSigningWalletEffect(derivationEffect)
  }

/**
 * Private key wallet — returns a chain-aware factory.
 * Chain context (networkId) is injected automatically by `client(chain).withPrivateKey(...)`.
 *
 * @since 2.1.0
 * @category constructors
 */
export const privateKeyWallet =
  (config: PrivateKeyWalletConfig) =>
  (chain: Chain): Wallet.SigningWallet => {
    const derivationEffect = Derivation.walletFromPrivateKey(config.paymentKey, {
      stakeKeyBech32: config.stakeKey,
      addressType: config.addressType ?? (config.stakeKey ? "Base" : "Enterprise"),
      networkId: chain.id
    }).pipe(Effect.mapError((cause) => new Wallet.WalletError({ message: cause.message, cause })))
    return Signing.makeSigningWalletEffect(derivationEffect)
  }

/**
 * CIP-30 browser wallet — wraps a wallet API (e.g. from `window.cardano.nami.enable()`).
 *
 * @since 2.1.0
 * @category constructors
 */
export const cip30Wallet =
  (api: Wallet.WalletApi) =>
  (chain: Chain): Wallet.ApiWallet => {
  const fetchAddress = Effect.gen(function* () {
    const used = yield* Effect.tryPromise({
      try: () => api.getUsedAddresses(),
      catch: (e) => new Wallet.WalletError({ message: "Failed to fetch used addresses", cause: e as Error })
    })
    const unused = yield* Effect.tryPromise({
      try: () => api.getUnusedAddresses(),
      catch: (e) => new Wallet.WalletError({ message: "Failed to fetch unused addresses", cause: e as Error })
    })
    const addrStr = used[0] ?? unused[0]
    if (!addrStr) return yield* Effect.fail(new Wallet.WalletError({ message: "Wallet API returned no addresses" }))
    const resolvedAddress = yield* Effect.orElse(
      Effect.try({ try: () => CoreAddress.fromBech32(addrStr), catch: () => addrStr }),
      () =>
        Effect.try({
          try: () => CoreAddress.fromHex(addrStr),
          catch: (e) => new Wallet.WalletError({ message: `Invalid address format from wallet: ${addrStr}`, cause: e as Error })
        })
    )
    const networkId = CoreAddress.getNetworkId(resolvedAddress)
    if (networkId !== chain.id) {
      return yield* Effect.fail(
        new Wallet.WalletError({
          message: `Wallet network mismatch: wallet is on network ${networkId} but chain id is ${chain.id}`
        })
      )
    }
    return resolvedAddress
  })

  const fetchRewardAddress = Effect.gen(function* () {
    const rewards = yield* Effect.tryPromise({
      try: () => api.getRewardAddresses(),
      catch: (e) => new Wallet.WalletError({ message: "Failed to fetch reward addresses", cause: e as Error })
    })
    if (!rewards[0]) return null
    const rewardAddress = yield* Schema.decodeUnknown(CoreRewardAddress.RewardAddress)(rewards[0]).pipe(
      Effect.mapError((e) => new Wallet.WalletError({ message: `Invalid reward address from wallet`, cause: e }))
    )
    return yield* validateRewardAddressNetwork(rewardAddress, chain)
  })

  const effectInterface: Wallet.ApiWalletEffect = {
    address: () => fetchAddress,
    rewardAddress: () => fetchRewardAddress,
    signTx: (txOrHex: Transaction.Transaction | string, _context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const witnessHex = yield* Effect.tryPromise({
          try: () => api.signTx(cbor, true),
          catch: (cause) =>
            new Wallet.WalletError({
              message: `Failed to sign transaction: ${(cause as Error).message ?? cause}`,
              cause
            })
        })
        return yield* ParseResult.decodeUnknownEither(TransactionWitnessSet.FromCBORHex())(witnessHex).pipe(
          Effect.mapError((cause) => new Wallet.WalletError({ message: `Failed to decode witness set: ${cause}`, cause }))
        )
      }),
    signMessage: (address: CoreAddress.Address | CoreRewardAddress.RewardAddress, payload: Wallet.Payload) =>
      Effect.gen(function* () {
        const addressHex =
          address instanceof CoreAddress.Address
            ? CoreAddress.toHex(address)
            : CoreRewardAccount.toHex(CoreRewardAccount.fromBech32(address))
        const result = yield* Effect.tryPromise({
          try: () => api.signData(addressHex, payload),
          catch: (cause) => new Wallet.WalletError({ message: "User rejected message signing", cause })
        })
        return { payload, signature: result.signature }
      }),
    signTxs: (txs: ReadonlyArray<Transaction.Transaction | string>, _context?: { utxos?: ReadonlyArray<CoreUTxO.UTxO> }) =>
      Effect.gen(function* () {
        const cborHexes = txs.map((txOrHex) => typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex))
        const requests = cborHexes.map((cbor) => ({ cbor, partialSign: true }))

        // Try CIP-103 standard namespace, then experimental, then direct, then fallback
        const signTxsFn =
          api.cip103?.signTxs?.bind(api.cip103) ??
          api.experimental?.signTxs?.bind(api.experimental) ??
          api.signTxs?.bind(api)

        let witnessHexes: ReadonlyArray<string>
        if (signTxsFn) {
          witnessHexes = yield* Effect.tryPromise({
            try: () => signTxsFn(requests),
            catch: (cause) =>
              new Wallet.WalletError({
                message: `Failed to batch sign transactions: ${(cause as Error).message ?? cause}`,
                cause
              })
          })
        } else {
          // Fallback: sequential signing
          const results: Array<string> = []
          for (const cbor of cborHexes) {
            const witness = yield* Effect.tryPromise({
              try: () => api.signTx(cbor, true),
              catch: (cause) =>
                new Wallet.WalletError({
                  message: `Failed to sign transaction: ${(cause as Error).message ?? cause}`,
                  cause
                })
            })
            results.push(witness)
          }
          witnessHexes = results
        }

        return yield* Effect.all(
          witnessHexes.map((hex) =>
            ParseResult.decodeUnknownEither(TransactionWitnessSet.FromCBORHex())(hex).pipe(
              Effect.mapError((cause) => new Wallet.WalletError({ message: `Failed to decode witness set: ${cause}`, cause }))
            )
          )
        )
      }),
    submitTx: (txOrHex: Transaction.Transaction | string) =>
      Effect.gen(function* () {
        const cbor = typeof txOrHex === "string" ? txOrHex : Transaction.toCBORHex(txOrHex)
        const txHashHex = yield* Effect.tryPromise({
          try: () => api.submitTx(cbor),
          catch: (cause) => new Wallet.WalletError({ message: (cause as Error).message, cause: cause as Error })
        })
        return Schema.decodeSync(TransactionHash.FromHex)(txHashHex)
      })
  }

  return {
    type: "api" as const,
    api,
    address: () => runEffectPromise(effectInterface.address()),
    rewardAddress: () => runEffectPromise(effectInterface.rewardAddress()),
    signTx: (txOrHex, context) => runEffectPromise(effectInterface.signTx(txOrHex, context)),
    signTxs: (txs, context) => runEffectPromise(effectInterface.signTxs(txs, context)),
    signMessage: (address, payload) => runEffectPromise(effectInterface.signMessage(address, payload)),
    submitTx: (txOrHex) => runEffectPromise(effectInterface.submitTx(txOrHex)),
    effect: effectInterface
  }
}
