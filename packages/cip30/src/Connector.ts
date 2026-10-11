/**
 * CIP-30 wallet connector, returning the exact wire encodings.
 *
 * `getUtxos` and `getCollateral` return `TransactionUnspentOutput` hex (`[input, output]`),
 * `getBalance` a `Value` hex, and the address methods RAW address bytes as hex — CIP-30 uses hex,
 * not bech32. Plus CIP-95 (governance keys), CIP-103 (batch signing shapes), CIP-104 (account
 * public key) and CIP-142 (network magic).
 *
 * ## Scope: this is the READ surface
 *
 * It deliberately does NOT carry `signTx` / `signTxs` / `signData`. A signing method reachable
 * straight off a connector is a footgun for anyone embedding it: this layer owns byte-exactness,
 * not authorization. A wallet answers signing requests with a sentinel its host catches, then runs
 * its own review and key-custody ceremony. The signing ENCODINGS live in
 * {@link ReferenceSigning}, kept separate and clearly labelled.
 *
 * @since 0.1.0
 */
import * as Address from "@evolution-sdk/evolution/Address"
import * as Assets from "@evolution-sdk/evolution/Assets"
import * as Bip32PrivateKey from "@evolution-sdk/evolution/Bip32PrivateKey"
import * as Bip32PublicKey from "@evolution-sdk/evolution/Bip32PublicKey"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import * as RewardAddress from "@evolution-sdk/evolution/RewardAddress"
import * as Script from "@evolution-sdk/evolution/Script"
import * as ScriptRef from "@evolution-sdk/evolution/ScriptRef"
import * as Provider from "@evolution-sdk/evolution/sdk/provider/Provider"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionInput from "@evolution-sdk/evolution/TransactionInput"
import * as TxOut from "@evolution-sdk/evolution/TxOut"
import type * as UTxO from "@evolution-sdk/evolution/UTxO"
import * as Value from "@evolution-sdk/evolution/Value"
import { Effect } from "effect"

import type { Account } from "./Account.js"
import { type ConsentDenied, ConsentTag } from "./Consent.js"

/** What a connector read can fail with. */
type Fail = Provider.ProviderError

/**
 * @since 0.1.0
 * @category model
 */
export type ConnEff<A> = Effect.Effect<A, Fail>

/**
 * A consent-gated read: additionally requires `ConsentTag` and can fail `ConsentDenied`.
 *
 * @since 0.1.0
 * @category model
 */
export type ConsentEff<A> = Effect.Effect<A, Fail | ConsentDenied, ConsentTag>

/**
 * @since 0.1.0
 * @category model
 */
export interface Connector {
  readonly getExtensions: () => ConnEff<ReadonlyArray<{ readonly cip: number }>>
  readonly getNetworkId: () => ConnEff<number>
  /** CIP-142: the network magic, which disambiguates testnets where `getNetworkId` cannot. */
  readonly getNetworkMagic: () => ConnEff<number>
  /** `TransactionUnspentOutput` hexes: `[input, output]`. */
  readonly getUtxos: () => ConnEff<ReadonlyArray<string>>
  /** Pure-ADA `TransactionUnspentOutput` hexes, usable as collateral. */
  readonly getCollateral: () => ConnEff<ReadonlyArray<string>>
  /** Total `Value` across the account's UTxOs, as CBOR hex. */
  readonly getBalance: () => ConnEff<string>
  /** Raw address bytes as hex. */
  readonly getUsedAddresses: () => ConnEff<ReadonlyArray<string>>
  readonly getUnusedAddresses: () => ConnEff<ReadonlyArray<string>>
  readonly getChangeAddress: () => ConnEff<string>
  readonly getRewardAddresses: () => ConnEff<ReadonlyArray<string>>
  /**
   * CIP-104: the account-level extended public key.
   *
   * SENSITIVE — it reveals every address and the whole history, so it is CONSENT-GATED. It
   * cannot be served without the app's approval implementation.
   */
  readonly getAccountPublicKey: () => ConsentEff<string>
  readonly submitTx: (signedTxHex: string) => ConnEff<string>
  /** CIP-95. */
  readonly getPubDRepKey: () => ConnEff<string>
  readonly getRegisteredPubStakeKeys: () => ConnEff<ReadonlyArray<string>>
  readonly getUnregisteredPubStakeKeys: () => ConnEff<ReadonlyArray<string>>
}

/** `[input, output]`, splicing the encoded children rather than re-encoding them. */
const unspentOutput = (utxo: UTxO.UTxO): string => {
  const input = TransactionInput.toCBORHex(
    new TransactionInput.TransactionInput({ transactionId: utxo.transactionId, index: utxo.index })
  )
  const output = TxOut.toCBORHex(
    new TxOut.TransactionOutput({
      address: utxo.address,
      assets: utxo.assets,
      encodingFormat: "babbage",
      ...(utxo.datumOption ? { datumOption: utxo.datumOption } : {}),
      // A UTxO carries the script itself; an output slot carries it wrapped as a reference.
      ...(utxo.scriptRef ? { scriptRef: new ScriptRef.ScriptRef({ bytes: Script.toCBOR(utxo.scriptRef) }) } : {})
    })
  )
  return `82${input}${output}`
}

const valueOf = (assets: Assets.Assets): Value.Value => {
  const multi = Assets.getMultiAsset(assets)
  return multi === undefined
    ? Value.onlyCoin(Assets.lovelaceOf(assets))
    : Value.withAssets(Assets.lovelaceOf(assets), multi)
}

const publicKeyHexOf = (node: Bip32PrivateKey.Bip32PrivateKey): string =>
  Bip32PublicKey.toHex(Bip32PrivateKey.toPublicKey(node)).slice(0, 64)

/**
 * Build a connector for `account` on `networkId` (0 testnet, 1 mainnet), served by `provider`.
 *
 * `networkMagic` (CIP-142) disambiguates testnets; it defaults to mainnet for id 1 and preprod
 * otherwise, so preview or a custom network must pass it.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (
  account: Account,
  provider: Provider.ProviderEffect,
  networkId: number,
  networkMagic: number = networkId === 1 ? 764824073 : 1
): Connector => {
  const address = account.baseAddress(networkId)
  const addrHex = Address.toHex(address)
  const reward = account.rewardAddress(networkId)
  const rewardHex = RewardAccount.toHex(reward)
  const rewardBech32 = RewardAccount.toBech32(reward)

  const utxosWith = (keep: (u: UTxO.UTxO) => boolean) =>
    provider.getUtxos(address).pipe(Effect.map((utxos) => utxos.filter(keep).map(unspentOutput)))

  return {
    /**
     * Only what THIS interface serves. CIP-139 is deliberately absent even where the provider
     * could answer for it: advertising an extension a host cannot serve strands a dApp at the
     * first call, which is the same failure the CIP-95 split below exists to prevent.
     */
    getExtensions: () => Effect.succeed([{ cip: 95 }, { cip: 103 }, { cip: 104 }, { cip: 142 }]),
    getNetworkId: () => Effect.succeed(networkId),
    getNetworkMagic: () => Effect.succeed(networkMagic),
    getUtxos: () => utxosWith(() => true),
    getCollateral: () => utxosWith((u) => !Assets.hasMultiAsset(u.assets)),
    getBalance: () =>
      provider.getUtxos(address).pipe(
        Effect.map((utxos) =>
          Value.toCBORHex(
            utxos.reduce<Value.Value>((total, u) => Value.add(total, valueOf(u.assets)), Value.onlyCoin(0n))
          )
        )
      ),
    getUsedAddresses: () => Effect.succeed([addrHex]),
    getUnusedAddresses: () => Effect.succeed([]),
    getChangeAddress: () => Effect.succeed(addrHex),
    getRewardAddresses: () => Effect.succeed([rewardHex]),
    getAccountPublicKey: () =>
      Effect.gen(function* () {
        // SENSITIVE: gate on user consent before revealing the account xpub.
        yield* (yield* ConsentTag).request({
          method: "getAccountPublicKey",
          detail: "Share the account extended public key (reveals every address and the full history)."
        })
        // m/1852'/1815'/account' -- the ACCOUNT level, which is what CIP-104 shares. There is
        // no named helper for it: the others all descend to a role and an index.
        const { harden } = Bip32PrivateKey.CardanoPath
        const node = Bip32PrivateKey.derive(account.rootXprv, [harden(1852), harden(1815), harden(account.accountIndex)])
        return Bip32PublicKey.toHex(Bip32PrivateKey.toPublicKey(node))
      }),
    submitTx: (hex) =>
      provider.submitTx(Transaction.fromCBORHex(hex)).pipe(Effect.map((h) => h.toString())),
    getPubDRepKey: () => Effect.succeed(publicKeyHexOf(account.drepKey())),
    /**
     * ⚠️ CIP-95: which of the wallet's stake keys are REGISTERED is chain state, not something
     * derivable from the seed. An empty list is a factual claim ("none of my keys are
     * registered"), not a safe default: a dApp reads it to decide whether a vote-delegation
     * certificate needs a registration certificate beside it. So a backend that cannot answer
     * FAILS here rather than answering wrongly.
     */
    getRegisteredPubStakeKeys: () => stakeKeys(true),
    getUnregisteredPubStakeKeys: () => stakeKeys(false)
  }

  function stakeKeys(wantRegistered: boolean): ConnEff<ReadonlyArray<string>> {
    return provider.getDelegation(RewardAddress.RewardAddress.make(rewardBech32)).pipe(
      Effect.flatMap((delegation) =>
        delegation.registered === undefined
          ? Effect.fail(
            new Provider.ProviderError({
              message:
                "CIP-95 registered/unregistered stake-key split needs Delegation.registered, which this provider does not report",
              cause: "capability"
            })
          )
          : Effect.succeed(
            delegation.registered === wantRegistered ? [publicKeyHexOf(account.stakeKey())] : []
          )
      )
    )
  }
}
