import "@evolution-sdk/scalus-emulator"

import * as Assets from "@evolution-sdk/evolution/Assets"
import * as Address from "@evolution-sdk/evolution/Address"
import * as SlotConfig from "@evolution-sdk/evolution/Time/SlotConfig"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"
import { createClient } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import type { NodeEmulatorConfig } from "@evolution-sdk/evolution/sdk/client/Client"
import type { SigningClient } from "@evolution-sdk/evolution/sdk/client/Client"
import type { SlotConfig as SlotConfigType } from "@evolution-sdk/evolution/Time/SlotConfig"
import type * as Cardano from "@evolution-sdk/evolution"

export const TEST_MNEMONIC =
  "test test test test test test test test test test test test test test test test test test test test test test test sauce"

export const DEVNET_SLOT_CONFIG = SlotConfig.SLOT_CONFIG_NETWORK.Preprod

export interface EmulatorTestSetup {
  client: SigningClient
  genesisUtxos: ReadonlyArray<UTxO.UTxO>
  address: Address.Address
  slotConfig: SlotConfigType
}

export async function createNodeEmulatorSetup(opts?: {
  accountIndex?: number
  lovelace?: bigint
  nodeEmulatorOverrides?: Partial<NodeEmulatorConfig>
}): Promise<EmulatorTestSetup> {
  const accountIndex = opts?.accountIndex ?? 0
  const lovelace = opts?.lovelace ?? 500_000_000_000n
  const slotConfig = opts?.nodeEmulatorOverrides?.slotConfig ?? DEVNET_SLOT_CONFIG

  const tempClient = createClient({
    network: 0,
    wallet: { type: "seed", mnemonic: TEST_MNEMONIC, accountIndex, addressType: "Base" }
  })
  const address = await tempClient.address()

  const genesisTxId = TransactionHash.fromHex("00".repeat(32))
  const genesisUtxos: ReadonlyArray<UTxO.UTxO> = [
    new UTxO.UTxO({
      transactionId: genesisTxId,
      index: 0n,
      address,
      assets: Assets.fromLovelace(lovelace)
    })
  ]

  const client = createClient({
    network: 0,
    slotConfig,
    provider: {
      type: "node-emulator",
      slotConfig,
      initialUtxos: genesisUtxos,
      ...opts?.nodeEmulatorOverrides
    },
    wallet: {
      type: "seed",
      mnemonic: TEST_MNEMONIC,
      accountIndex,
      addressType: "Base"
    }
  })

  return { client, genesisUtxos, address, slotConfig }
}
