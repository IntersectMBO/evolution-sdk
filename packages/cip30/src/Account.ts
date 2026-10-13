/**
 * A wallet account: the keys and addresses a connector serves, derived from a BIP-32 root.
 *
 * ## Key handling
 *
 * This holds the root extended private key, so it is the wrong shape for a wallet whose keys
 * live in an enclave or on a device. Such a wallet should serve the read surface from an account
 * built on a public key and sign through its own ceremony, never handing key material here.
 *
 * What IS defended is **accidental** disclosure. `rootXprv` is non-enumerable, and both
 * `toJSON()` and Node's inspect hook redact it, so `JSON.stringify(account)`,
 * `console.log(account)`, spreads and naive property walks cannot leak it. What remains is a
 * caller explicitly reading a key and then logging it, which no library can prevent.
 *
 * @since 0.1.0
 */
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bip32PrivateKey from "@evolution-sdk/evolution/Bip32PrivateKey"
import * as KeyHash from "@evolution-sdk/evolution/KeyHash"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"

/**
 * @since 0.1.0
 * @category model
 */
export interface Account {
  /**
   * The root extended PRIVATE key. Non-enumerable and redacted from `toJSON` and inspect; never
   * log it, and prefer `paymentKey` / `stakeKey` so the derivation path is explicit.
   */
  readonly rootXprv: Bip32PrivateKey.Bip32PrivateKey
  readonly accountIndex: number
  /** The external payment key at role 0, `index`. PRIVATE key material. */
  readonly paymentKey: (index?: number) => Bip32PrivateKey.Bip32PrivateKey
  /** The stake key, role 2 index 0. PRIVATE key material. */
  readonly stakeKey: () => Bip32PrivateKey.Bip32PrivateKey
  /** The DRep key a wallet votes with, CIP-1852 role 3. PRIVATE key material. */
  readonly drepKey: (index?: number) => Bip32PrivateKey.Bip32PrivateKey
  readonly paymentKeyHash: (index?: number) => KeyHash.KeyHash
  readonly stakeKeyHash: () => KeyHash.KeyHash
  /** Base address (payment role 0/`index` plus stake) for `networkId`. */
  readonly baseAddress: (networkId: number, index?: number) => Address.Address
  /** Enterprise, payment-only, address. */
  readonly enterpriseAddress: (networkId: number, index?: number) => Address.Address
  /** Reward (stake) address. */
  readonly rewardAddress: (networkId: number) => RewardAccount.RewardAccount
}

const keyHashOf = (node: Bip32PrivateKey.Bip32PrivateKey): KeyHash.KeyHash =>
  KeyHash.fromPrivateKey(Bip32PrivateKey.toPrivateKey(node))

/**
 * Build an account from a BIP-32 root key.
 *
 * @since 0.1.0
 * @category constructors
 */
export const fromRoot = (rootXprv: Bip32PrivateKey.Bip32PrivateKey, accountIndex = 0): Account => {
  const derive = (indices: Array<number>) => Bip32PrivateKey.derive(rootXprv, indices)
  const paymentKey = (index = 0) => derive(Bip32PrivateKey.CardanoPath.paymentIndices(accountIndex, index))
  const stakeKey = () => derive(Bip32PrivateKey.CardanoPath.stakeIndices(accountIndex, 0))
  const drepKey = (index = 0) => derive(Bip32PrivateKey.CardanoPath.drepIndices(accountIndex, index))
  const paymentKeyHash = (index = 0) => keyHashOf(paymentKey(index))
  const stakeKeyHash = () => keyHashOf(stakeKey())

  const account = {
    accountIndex,
    paymentKey,
    stakeKey,
    drepKey,
    paymentKeyHash,
    stakeKeyHash,
    // `Address` is the one structure for every era; a base address is simply one that carries a
    // staking credential and an enterprise address is one that does not.
    baseAddress: (networkId: number, index = 0) =>
      new Address.Address({
        networkId,
        paymentCredential: paymentKeyHash(index),
        stakingCredential: stakeKeyHash()
      }),
    enterpriseAddress: (networkId: number, index = 0) =>
      new Address.Address({ networkId, paymentCredential: paymentKeyHash(index) }),
    rewardAddress: (networkId: number) =>
      new RewardAccount.RewardAccount({ networkId, stakeCredential: stakeKeyHash() }),
    // Redact on the two paths that leak key material by ACCIDENT rather than by a caller asking
    // for it: `JSON.stringify` (crash reporters, structured logs, state dumps) and `util.inspect`
    // (`console.log(account)`, a REPL, dev tooling). Cheap, and it covers the realistic route.
    toJSON: () => ({ accountIndex, rootXprv: "[redacted]" }),
    [Symbol.for("nodejs.util.inspect.custom")]: () =>
      `Account { accountIndex: ${accountIndex}, rootXprv: [redacted] }`
  }
  // Non-enumerable so a spread, `Object.keys` or a naive property walk cannot copy the root key
  // out. Still readable as `account.rootXprv`: signing needs it, and hiding it behind a getter
  // would only move the problem.
  Object.defineProperty(account, "rootXprv", { value: rootXprv, enumerable: false, writable: false })
  return account as unknown as Account
}
