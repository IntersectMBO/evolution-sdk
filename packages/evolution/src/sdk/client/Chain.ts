/**
 * Chain descriptor — bundles all network context needed by clients and builders.
 *
 * Replaces the stringly-typed `NetworkId` and the separate `slotConfig` parameter.
 * Pass a chain preset (`mainnet`, `preprod`, `preview`) or define a custom one for
 * private networks and devnets.
 *
 * @since 2.1.0
 * @module
 */

import type { SlotConfig } from "../../SlotConfig.js"
import { SLOT_CONFIG_NETWORK } from "../../SlotConfig.js"

/**
 * Describes a Cardano network — its identity, consensus parameters, and slot timing.
 *
 * @since 2.1.0
 * @category model
 */
export interface Chain {
  /** Numeric network id: 1 = mainnet, 0 = testnet. Used for address encoding. */
  readonly id: number
  /** Human-readable name, e.g. "Cardano Mainnet". */
  readonly name: string
  /** Network magic — uniquely identifies the network for peer-to-peer communication. */
  readonly networkMagic: number
  /** Epoch length in seconds. */
  readonly epochLength: number
  /** Slot timing parameters required for validity interval conversion. */
  readonly slotConfig: SlotConfig
}

/**
 * Cardano mainnet.
 *
 * @since 2.1.0
 * @category presets
 */
export const mainnet: Chain = {
  id: 1,
  name: "Cardano Mainnet",
  networkMagic: 764824073,
  epochLength: 432000,
  slotConfig: SLOT_CONFIG_NETWORK["Mainnet"],
}

/**
 * Cardano pre-production testnet.
 *
 * @since 2.1.0
 * @category presets
 */
export const preprod: Chain = {
  id: 0,
  name: "Cardano Preprod",
  networkMagic: 1,
  epochLength: 432000,
  slotConfig: SLOT_CONFIG_NETWORK["Preprod"],
}

/**
 * Cardano preview testnet.
 *
 * @since 2.1.0
 * @category presets
 */
export const preview: Chain = {
  id: 0,
  name: "Cardano Preview",
  networkMagic: 2,
  epochLength: 86400,
  slotConfig: SLOT_CONFIG_NETWORK["Preview"],
}
