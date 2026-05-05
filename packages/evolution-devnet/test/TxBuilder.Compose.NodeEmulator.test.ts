import { describe, expect, it } from "@effect/vitest"
import { Cardano } from "@evolution-sdk/evolution"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import { createNodeEmulatorSetup, TEST_MNEMONIC } from "./utils/nodeEmulator.js"

const Time = Cardano.Time

describe("TxBuilder compose (node-emulator)", () => {
  it("should compose payment with validity constraints", async () => {
    const { client, genesisUtxos } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const paymentBuilder = client.newTx().payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(5_000_000n)
    })

    const validityBuilder = client.newTx().setValidity({
      to: Time.now() + 300_000n
    })

    const signBuilder = await client
      .newTx()
      .compose(paymentBuilder)
      .compose(validityBuilder)
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    expect(tx.body.ttl).toBeDefined()
    expect(tx.body.ttl).toBeGreaterThan(0n)

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should compose multiple payment builders to different addresses", async () => {
    const { client: client1, genesisUtxos } = await createNodeEmulatorSetup()
    const client2 = createClient({
      network: 0,
      wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex: 1, addressType: "Base" }
    })

    const address1 = await client1.address()
    const address2 = await client2.address()

    const payment1 = client1.newTx().payToAddress({
      address: address1,
      assets: Cardano.Assets.fromLovelace(3_000_000n)
    })
    const payment2 = client1.newTx().payToAddress({
      address: address2,
      assets: Cardano.Assets.fromLovelace(2_000_000n)
    })
    const payment3 = client1.newTx().payToAddress({
      address: address1,
      assets: Cardano.Assets.fromLovelace(4_000_000n)
    })

    const signBuilder = await client1
      .newTx()
      .compose(payment1)
      .compose(payment2)
      .compose(payment3)
      .build({ availableUtxos: [...genesisUtxos] })

    const tx = await signBuilder.toTransaction()
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(3)

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should compose builder with addSigner + metadata + payment", async () => {
    const { client } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const paymentCredential = myAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") throw new Error("Expected KeyHash credential")

    const signerBuilder = client.newTx().addSigner({ keyHash: paymentCredential })
    const metadataBuilder = client.newTx().attachMetadata({
      label: 674n,
      metadata: "Multi-sig transaction"
    })
    const paymentBuilder = client.newTx().payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(6_000_000n)
    })

    const signBuilder = await client
      .newTx()
      .compose(signerBuilder)
      .compose(metadataBuilder)
      .compose(paymentBuilder)
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.body.requiredSigners?.length).toBe(1)
    expect(tx.auxiliaryData).toBeDefined()
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1)

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should compose stake registration with payment and metadata", async () => {
    const { client } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    if (!("stakingCredential" in myAddress) || !myAddress.stakingCredential) {
      throw new Error("Expected BaseAddress with stakingCredential")
    }

    const stakeCredential = myAddress.stakingCredential

    const stakeBuilder = client.newTx().registerStake({ stakeCredential })
    const paymentBuilder = client.newTx().payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(10_000_000n)
    })
    const metadataBuilder = client.newTx().attachMetadata({
      label: 674n,
      metadata: "Stake registration transaction"
    })

    const signBuilder = await client
      .newTx()
      .compose(stakeBuilder)
      .compose(paymentBuilder)
      .compose(metadataBuilder)
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.body.certificates).toBeDefined()
    expect(tx.body.certificates?.length).toBe(1)
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(1)
    expect(tx.auxiliaryData).toBeDefined()

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should verify getPrograms returns accumulated operations", async () => {
    const { client } = await createNodeEmulatorSetup()
    const myAddress = await client.address()

    const builder = client
      .newTx()
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(1_000_000n)
      })
      .attachMetadata({ label: 1n, metadata: "Test" })

    const programs = builder.getPrograms()
    expect(programs.length).toBe(2)

    builder.payToAddress({
      address: myAddress,
      assets: Cardano.Assets.fromLovelace(2_000_000n)
    })

    const programs2 = builder.getPrograms()
    expect(programs2.length).toBe(3)
    expect(programs.length).toBe(2)
  })

  it("should compose builders created from different clients", async () => {
    const { client: client1 } = await createNodeEmulatorSetup()
    const setup2 = await createNodeEmulatorSetup({ accountIndex: 1 })
    const client2 = setup2.client

    const address1 = await client1.address()
    const address2 = await client2.address()

    const builder1 = client1.newTx().payToAddress({
      address: address1,
      assets: Cardano.Assets.fromLovelace(5_000_000n)
    })
    const builder2 = client2.newTx().attachMetadata({
      label: 42n,
      metadata: "Cross-client composition"
    })

    const signBuilder = await client1
      .newTx()
      .compose(builder1)
      .compose(builder2)
      .payToAddress({
        address: address2,
        assets: Cardano.Assets.fromLovelace(3_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()
    expect(tx.body.outputs.length).toBeGreaterThanOrEqual(2)
    expect(tx.auxiliaryData).toBeDefined()

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(Cardano.TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })
})
