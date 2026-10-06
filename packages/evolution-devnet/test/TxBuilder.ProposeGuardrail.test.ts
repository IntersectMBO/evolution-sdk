/**
 * Devnet tests for proposals checked by a constitution guardrail script.
 * The devnet constitution references an always-succeeding PlutusV3 guardrail,
 * so TreasuryWithdrawals and ParameterChange proposals must carry its policy
 * hash, provide the script and run it under the propose purpose.
 */

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest"
import * as Cluster from "@evolution-sdk/devnet/Cluster"
import * as Config from "@evolution-sdk/devnet/Config"
import * as Genesis from "@evolution-sdk/devnet/Genesis"
import { Cardano, Client, preprod } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as Anchor from "@evolution-sdk/evolution/Anchor"
import * as Assets from "@evolution-sdk/evolution/Assets"
import * as Bytes from "@evolution-sdk/evolution/Bytes"
import * as Bytes32 from "@evolution-sdk/evolution/Bytes32"
import * as Data from "@evolution-sdk/evolution/Data"
import * as GovernanceAction from "@evolution-sdk/evolution/GovernanceAction"
import * as PlutusV3 from "@evolution-sdk/evolution/PlutusV3"
import * as RewardAccount from "@evolution-sdk/evolution/RewardAccount"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Url from "@evolution-sdk/evolution/Url"

import plutusJson from "../../evolution/test/spec/plutus.json"

const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

const guardrailScript = new PlutusV3.PlutusV3({
  bytes: Bytes.fromHex(
    plutusJson.validators.find((v) => v.title === "governance_guardrail.always_yes_guardrail.propose")!.compiledCode
  )
})
const guardrailHash = ScriptHash.fromScript(guardrailScript)

const makeAnchor = (url: string) =>
  new Anchor.Anchor({
    anchorUrl: new Url.Url({ href: url }),
    anchorDataHash: Bytes32.fromHex("0".repeat(64))
  })

describe("TxBuilder propose with guardrail script", () => {
  let devnetCluster: Cluster.Cluster | undefined
  let genesisUtxo: Cardano.UTxO.UTxO | undefined
  let rewardAccount: RewardAccount.RewardAccount | undefined

  const createTestClient = (accountIndex: number = 0) => {
    if (!devnetCluster) throw new Error("Cluster not initialized")
    return Client.make(Cluster.getChain(devnetCluster))
      .withKupmios({
        kupoUrl: `http://localhost:${devnetCluster.ports.kupo}`,
        ogmiosUrl: `http://localhost:${devnetCluster.ports.ogmios}`
      })
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" })
  }

  const treasuryWithdrawal = (policyHash: ScriptHash.ScriptHash | null) =>
    new GovernanceAction.TreasuryWithdrawalsAction({
      withdrawals: new Map([[rewardAccount!, 1_000_000n]]),
      policyHash
    })

  beforeAll(async () => {
    const address = await Client.make(preprod)
      .withSeed({ mnemonic: TEST_MNEMONIC, accountIndex: 0, addressType: "Base" })
      .address()

    const genesisConfig: Config.ShelleyGenesis = {
      ...Config.DEFAULT_SHELLEY_GENESIS,
      slotLength: 0.02,
      epochLength: 50,
      activeSlotsCoeff: 1.0,
      initialFunds: { [Address.toHex(address)]: 500_000_000_000 }
    }

    const genesisUtxos = await Genesis.calculateUtxosFromConfig(genesisConfig)
    genesisUtxo = genesisUtxos.find((u) => Address.toBech32(u.address) === Address.toBech32(address))

    devnetCluster = await Cluster.make({
      clusterName: "propose-guardrail-test",
      shelleyGenesis: genesisConfig,
      conwayGenesis: {
        ...Config.DEFAULT_CONWAY_GENESIS,
        constitution: {
          ...Config.DEFAULT_CONWAY_GENESIS.constitution,
          script: ScriptHash.toHex(guardrailHash)
        }
      },
      kupo: { enabled: true, logLevel: "Info" },
      ogmios: { enabled: true, logLevel: "info" }
    })

    await Cluster.start(devnetCluster)
    await new Promise((r) => setTimeout(r, 3_000))

    // Treasury withdrawals must pay to a registered reward account
    const client = createTestClient(0)
    if (!address.stakingCredential) throw new Error("Need staking credential")
    const stakeRegTx = await client
      .newTx()
      .registerStake({ stakeCredential: address.stakingCredential })
      .build({ availableUtxos: [genesisUtxo!] })
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(stakeRegTx, 1000)).toBe(true)
    await new Promise((r) => setTimeout(r, 2_000))

    rewardAccount = new RewardAccount.RewardAccount({ networkId: 0, stakeCredential: address.stakingCredential })
  }, 180_000)

  afterAll(async () => {
    if (devnetCluster) {
      await Cluster.stop(devnetCluster)
      await Cluster.remove(devnetCluster)
    }
  }, 60_000)

  it("rejects a treasury withdrawal that skips the guardrail", { timeout: 120_000 }, async () => {
    const client = createTestClient(0)

    await expect(
      client
        .newTx()
        .propose({
          governanceAction: treasuryWithdrawal(null),
          rewardAccount: rewardAccount!,
          anchor: makeAnchor("https://example.com/treasury.json")
        })
        .build()
        .then((b) => b.sign())
        .then((b) => b.submit())
    ).rejects.toThrow(/guardrails hash/)
  })

  it("submits a treasury withdrawal with an attached guardrail script", { timeout: 120_000 }, async () => {
    const client = createTestClient(0)

    const signBuilder = await client
      .newTx()
      .propose({
        governanceAction: treasuryWithdrawal(guardrailHash),
        rewardAccount: rewardAccount!,
        anchor: makeAnchor("https://example.com/treasury.json"),
        redeemer: Data.constr(0n, []),
        label: "guardrail"
      })
      .attachScript({ script: guardrailScript })
      .build()

    const tx = await signBuilder.toTransaction()
    const redeemers = tx.witnessSet.redeemers!.toArray()
    expect(redeemers).toHaveLength(1)
    expect(redeemers[0]!.tag).toBe("propose")
    expect(redeemers[0]!.exUnits.steps).toBeGreaterThan(0n)

    const txHash = await signBuilder.sign().then((b) => b.submit())
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
    await new Promise((r) => setTimeout(r, 2_000))
  })

  it("submits a guardrail-checked proposal next to an info action", { timeout: 120_000 }, async () => {
    const client = createTestClient(0)

    const txHash = await client
      .newTx()
      .propose({
        governanceAction: new GovernanceAction.InfoAction({}),
        rewardAccount: rewardAccount!,
        anchor: makeAnchor("https://example.com/info.json")
      })
      .propose({
        governanceAction: new GovernanceAction.ParameterChangeAction({
          govActionId: null,
          protocolParamUpdate: new Cardano.ProtocolParamUpdate.ProtocolParamUpdate({ maxTxSize: 16_385n }),
          policyHash: guardrailHash
        }),
        rewardAccount: rewardAccount!,
        anchor: makeAnchor("https://example.com/params.json"),
        redeemer: Data.constr(0n, [])
      })
      .attachScript({ script: guardrailScript })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())

    expect(await client.awaitTx(txHash, 1000)).toBe(true)
    await new Promise((r) => setTimeout(r, 2_000))
  })

  it("submits a treasury withdrawal using the guardrail from a reference input", { timeout: 120_000 }, async () => {
    const client = createTestClient(0)
    const holder = await createTestClient(1).address()

    // Deploy the guardrail as a reference script at an address the wallet does not spend from
    const deployTx = await client
      .newTx()
      .payToAddress({ address: holder, assets: Assets.fromLovelace(20_000_000n), script: guardrailScript })
      .build()
      .then((b) => b.sign())
      .then((b) => b.submit())
    expect(await client.awaitTx(deployTx, 1000)).toBe(true)
    await new Promise((r) => setTimeout(r, 2_000))

    const refUtxo = (await client.getUtxos(holder)).find((u) => u.scriptRef?._tag === "PlutusV3")
    if (!refUtxo) throw new Error("Reference script UTxO not found")

    const signBuilder = await client
      .newTx()
      .propose({
        governanceAction: treasuryWithdrawal(guardrailHash),
        rewardAccount: rewardAccount!,
        anchor: makeAnchor("https://example.com/treasury-ref.json"),
        redeemer: Data.constr(0n, [])
      })
      .readFrom({ referenceInputs: [refUtxo] })
      .build()

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.plutusV3Scripts?.length ?? 0).toBe(0)
    expect(tx.body.referenceInputs?.length).toBe(1)

    const txHash = await signBuilder.sign().then((b) => b.submit())
    expect(await client.awaitTx(txHash, 1000)).toBe(true)
  })
})
