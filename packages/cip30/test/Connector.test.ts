import * as Address from "@evolution-sdk/evolution/Address"
import * as Assets from "@evolution-sdk/evolution/Assets"
import * as Bip32PrivateKey from "@evolution-sdk/evolution/Bip32PrivateKey"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import { MockProvider } from "@evolution-sdk/evolution/sdk/provider/Mock"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"

import * as Account from "../src/Account.js"
import * as Connector from "../src/Connector.js"
import * as Consent from "../src/Consent.js"

const NETWORK = 0
const account = Account.fromRoot(Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16), ""), 0)
const address = account.baseAddress(NETWORK)
const rewardBech32 = RewardAccount.toBech32(account.rewardAddress(NETWORK))

const utxo = (txId: string, index: bigint, assets: Assets.Assets) =>
  new UTxO.UTxO({ transactionId: TransactionHash.fromHex(txId), index, address, assets })

const ADA_ONLY = utxo("a".repeat(64), 0n, Assets.fromLovelace(10_000_000n))
const WITH_TOKEN = utxo(
  "b".repeat(64),
  1n,
  Assets.fromRecord({ lovelace: 2_000_000n, [`${"ab".repeat(28)}746f6b656e`]: 5n })
)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const connectorWith = (config: ConstructorParameters<typeof MockProvider>[0]) =>
  Connector.make(account, new MockProvider(config).effect, NETWORK)

describe("Connector reads", () => {
  it("returns raw address bytes as hex, not bech32", async () => {
    const c = connectorWith({ utxos: [] })
    const change = await run(c.getChangeAddress())
    expect(change).toBe(Address.toHex(address))
    expect(change.startsWith("addr")).toBe(false)
    expect(await run(c.getUsedAddresses())).toEqual([change])
    expect(await run(c.getRewardAddresses())).toEqual([RewardAccount.toHex(account.rewardAddress(NETWORK))])
  })

  it("returns TransactionUnspentOutput hex: a two-element array of input and output", async () => {
    const c = connectorWith({ utxos: [ADA_ONLY] })
    const [entry] = await run(c.getUtxos())
    expect(entry?.startsWith("82")).toBe(true)
    // the input's transaction id appears verbatim inside the first element
    expect(entry).toContain("a".repeat(64))
  })

  it("offers only pure-ADA UTxOs as collateral", async () => {
    const c = connectorWith({ utxos: [ADA_ONLY, WITH_TOKEN] })
    expect(await run(c.getUtxos())).toHaveLength(2)
    const collateral = await run(c.getCollateral())
    expect(collateral).toHaveLength(1)
    expect(collateral[0]).toContain("a".repeat(64))
  })

  it("sums the balance across UTxOs", async () => {
    const c = connectorWith({ utxos: [ADA_ONLY, WITH_TOKEN] })
    const balance = await run(c.getBalance())
    // 12 ADA total, so the value is no longer a bare coin: it carries the token too
    expect(balance.length).toBeGreaterThan(10)
    const adaOnly = await run(connectorWith({ utxos: [ADA_ONLY] }).getBalance())
    expect(adaOnly).not.toBe(balance)
  })

  it("advertises only the extensions it can actually serve", async () => {
    const cips = (await run(connectorWith({ utxos: [] }).getExtensions())).map((e) => e.cip)
    expect(cips).toEqual([95, 103, 104, 142])
    expect(cips).not.toContain(139)
  })

  it("reports the network magic, which getNetworkId cannot disambiguate", async () => {
    const preprod = connectorWith({ utxos: [] })
    expect(await run(preprod.getNetworkId())).toBe(0)
    expect(await run(preprod.getNetworkMagic())).toBe(1)
    const preview = Connector.make(account, new MockProvider({ utxos: [] }).effect, 0, 2)
    expect(await run(preview.getNetworkId())).toBe(0)
    expect(await run(preview.getNetworkMagic())).toBe(2)
  })
})

describe("the account public key is consent-gated", () => {
  const c = connectorWith({ utxos: [] })

  it("cannot be served without an approval implementation", async () => {
    const exit = await Effect.runPromiseExit(c.getAccountPublicKey().pipe(Effect.provide(Consent.denyAll)))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("is served once approval is granted", async () => {
    const xpub = await run(c.getAccountPublicKey().pipe(Effect.provide(Consent.allowAll)))
    // xpub is the public key followed by the chain code
    expect(xpub).toHaveLength(128)
  })

  it("passes the method name to the approval callback, so a prompt can name it", async () => {
    const asked: Array<string> = []
    const layer = Consent.consentFrom((req) => {
      asked.push(req.method)
      return true
    })
    await run(c.getAccountPublicKey().pipe(Effect.provide(layer)))
    expect(asked).toEqual(["getAccountPublicKey"])
  })
})

/**
 * ⚠️ Which stake keys are REGISTERED is chain state. An empty list is a factual claim ("none of
 * my keys are registered"), not a safe default: a dApp reads it to decide whether a
 * vote-delegation certificate needs a registration certificate beside it.
 */
describe("CIP-95 stake-key split", () => {
  const delegation = (registered: boolean | undefined) => ({
    [rewardBech32]: { poolId: null, rewards: 0n, registered }
  })

  it("reports a registered key as registered and nothing as unregistered", async () => {
    const c = connectorWith({ utxos: [], delegations: delegation(true) })
    expect(await run(c.getRegisteredPubStakeKeys())).toHaveLength(1)
    expect(await run(c.getUnregisteredPubStakeKeys())).toHaveLength(0)
  })

  it("reports the other way round for an unregistered key", async () => {
    const c = connectorWith({ utxos: [], delegations: delegation(false) })
    expect(await run(c.getRegisteredPubStakeKeys())).toHaveLength(0)
    expect(await run(c.getUnregisteredPubStakeKeys())).toHaveLength(1)
  })

  it("FAILS rather than guessing when the backend cannot report registration", async () => {
    const c = connectorWith({ utxos: [], delegations: delegation(undefined) })
    const exit = await Effect.runPromiseExit(c.getRegisteredPubStakeKeys())
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
