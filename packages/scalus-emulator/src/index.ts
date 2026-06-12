import { registerNodeEmulatorProviderFactory } from "@evolution-sdk/evolution/sdk/client/ClientImpl"
import * as Scalus from "scalus"

import { buildUtxoMapCBOR, ScalusEmulatorProvider } from "./EmulatorProvider.js"

export { buildUtxoMapCBOR, ScalusEmulatorProvider }

registerNodeEmulatorProviderFactory((config) => {
  const initialUtxosCbor = buildUtxoMapCBOR(config.initialUtxos)
  const slotConfig = new Scalus.SlotConfig(
    Number(config.slotConfig.zeroTime),
    Number(config.slotConfig.zeroSlot),
    config.slotConfig.slotLength
  )

  const hasState = config.stakeRegistrations || config.poolRegistrations ||
    config.drepRegistrations || config.datums

  let emulator: Scalus.Emulator
  if (hasState) {
    const state: Scalus.EmulatorInitialState = {
      utxos: initialUtxosCbor,
      stakeRegistrations: config.stakeRegistrations,
      poolRegistrations: config.poolRegistrations,
      drepRegistrations: config.drepRegistrations,
      datums: config.datums
    }
    emulator = Scalus.Emulator.withState(state, slotConfig)
  } else {
    emulator = new Scalus.Emulator(initialUtxosCbor, slotConfig)
  }

  // Advance the emulator to the current wall-clock slot so that validity
  // interval checks (from/to) work correctly out of the box.
  const currentSlot = slotConfig.timeToSlot(Date.now())
  emulator.setSlot(currentSlot)

  return new ScalusEmulatorProvider(emulator, slotConfig, config.protocolParameters)
})
