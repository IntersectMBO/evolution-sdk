import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import { Client, preprod } from "../src/index.js"
import { MockProvider } from "../src/sdk/provider/Mock.js"
import * as TransactionHash from "../src/TransactionHash.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const MNEMONIC =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

const RECEIVER =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

describe("Client.withProvider", () => {
  it("reads through a provider this package does not ship", async () => {
    const utxo = createCoreTestUtxo({ transactionId: "a".repeat(64), address: RECEIVER, lovelace: 7_000_000n })
    const client = Client.make(preprod).withProvider(new MockProvider({ utxos: [utxo] }))

    const found = await client.getUtxos(CoreAddress.fromBech32(RECEIVER))

    expect(found).toHaveLength(1)
    expect(found[0].assets.lovelace).toBe(7_000_000n)
  })

  it("builds, signs and submits end to end with no network", async () => {
    const signer = Client.make(preprod).withSeed({ mnemonic: MNEMONIC })
    const own = CoreAddress.toBech32(await signer.address())
    const provider = new MockProvider({
      utxos: [createCoreTestUtxo({ transactionId: "a".repeat(64), address: own, lovelace: 20_000_000n })]
    })

    const sdk = signer.withProvider(provider)
    const built = await sdk
      .newTx()
      .payToAddress({ address: CoreAddress.fromBech32(RECEIVER), assets: CoreAssets.fromLovelace(5_000_000n) })
      .build()
    const hash = await (await built.sign()).submit()

    expect(await provider.awaitTx(hash)).toBe(true)
    const ledger = provider.ledger()
    expect(ledger.every((u) => TransactionHash.toHex(u.transactionId) === TransactionHash.toHex(hash))).toBe(true)
    const paid = ledger.find((u) => CoreAddress.toBech32(u.address) === RECEIVER)
    expect(paid?.assets.lovelace).toBe(5_000_000n)
  })
})
