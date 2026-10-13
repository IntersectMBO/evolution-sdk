/**
 * Time utilities for Cardano blockchain time operations.
 * Provides type-safe conversions between slots and Unix time.
 *
 * @module Time
 * @since 2.0.0
 */

import type * as Network from "./Network.js"
import type { Slot } from "./Slot.js"
import type { SlotConfig } from "./SlotConfig.js"
import { SLOT_CONFIG_NETWORK } from "./SlotConfig.js"
import type { UnixTime } from "./UnixTime.js"
import { now as nowFn } from "./UnixTime.js"

/**
 * ⚠️ `SLOT_CONFIG_NETWORK.Custom` ships as all zeros, to be filled in for an emulator or devnet.
 * Used unfilled, a `slotLength` of 0 makes `unixTimeToSlot` divide by zero and return a slot of
 * `Infinity`, or `0n` under BigInt semantics -- a number, either way, where there is no answer.
 */
const assertInDomain = (slotConfig: SlotConfig): void => {
  if (slotConfig.slotLength <= 0) {
    throw new Error(
      `slot configuration has a slotLength of ${slotConfig.slotLength}; the Custom config must be filled in before use`
    )
  }
}

/**
 * Convert a slot number to Unix time (in milliseconds).
 *
 * @param slot - The slot number to convert
 * @param slotConfig - The network's slot configuration
 * @returns Unix timestamp in milliseconds
 *
 * @category Conversion
 * @since 2.0.0
 *
 * @example
 * ```typescript
 * import * as Time from "@evolution-sdk/evolution/Time"
 *
 * const slot = 12345678n
 * const config = { zeroTime: 1596059091000n, zeroSlot: 4492800n, slotLength: 1000 }
 * const unixTime = Time.slotToUnixTime(slot, config)
 * ```
 */
export const slotToUnixTime = (slot: Slot, slotConfig: SlotConfig): UnixTime => {
  assertInDomain(slotConfig)
  // ⚠️ A `SlotConfig` describes ONE era with ONE slot length -- its own fields say "Shelley era".
  // Below `zeroSlot` the arithmetic silently extrapolates that slot length backwards through a
  // region where it did not hold: mainnet slot 0 is Byron, where slots were 20s, and this
  // returned a timestamp 988 DAYS late rather than refusing. A wrong date is worse than no date,
  // because nothing downstream can tell it from a real one.
  if (slot < slotConfig.zeroSlot) {
    throw new Error(
      `slot ${slot} is before this configuration's first slot (${slotConfig.zeroSlot}); it belongs to an earlier era with a different slot length`
    )
  }
  const msAfterBegin = (slot - slotConfig.zeroSlot) * BigInt(slotConfig.slotLength)
  return slotConfig.zeroTime + msAfterBegin
}

/**
 * Convert Unix time (in milliseconds) to the enclosing slot number.
 * Uses floor division to find the slot that contains the given time.
 *
 * @param unixTime - Unix timestamp in milliseconds
 * @param slotConfig - The network's slot configuration
 * @returns The slot number that contains this Unix time
 *
 * @category Conversion
 * @since 2.0.0
 *
 * @example
 * ```typescript
 * import * as Time from "@evolution-sdk/evolution/Time"
 *
 * const unixTime = 1596059091000n
 * const config = { zeroTime: 1596059091000n, zeroSlot: 4492800n, slotLength: 1000 }
 * const slot = Time.unixTimeToSlot(unixTime, config)
 * ```
 */
export const unixTimeToSlot = (unixTime: UnixTime, slotConfig: SlotConfig): Slot => {
  assertInDomain(slotConfig)
  // Same reason as `slotToUnixTime`: before `zeroTime` this configuration does not describe the
  // chain, and floor division would hand back a plausible slot from an era it knows nothing of.
  if (unixTime < slotConfig.zeroTime) {
    throw new Error(
      `unix time ${unixTime} is before this configuration's start (${slotConfig.zeroTime}); it belongs to an earlier era with a different slot length`
    )
  }
  const timePassed = unixTime - slotConfig.zeroTime
  const slotsPassed = timePassed / BigInt(slotConfig.slotLength)
  return slotsPassed + slotConfig.zeroSlot
}

/**
 * Get the current slot number for a network.
 *
 * @param network - The network to get current slot for
 * @returns Current slot number
 *
 * @category Utility
 * @since 2.0.0
 *
 * @example
 * ```typescript
 * import * as Time from "@evolution-sdk/evolution/Time"
 *
 * const currentSlot = Time.getCurrentSlot("Mainnet")
 * console.log(currentSlot) // Current mainnet slot
 * ```
 */
export const getCurrentSlot = (network: Network.Network): Slot => {
  const config = SLOT_CONFIG_NETWORK[network]
  const currentTime = nowFn()
  return unixTimeToSlot(currentTime, config)
}

/**
 * Check if a slot is in the future relative to current time.
 *
 * @param slot - The slot to check
 * @param slotConfig - The network's slot configuration
 * @returns True if the slot is in the future
 *
 * @category Utility
 * @since 2.0.0
 */
export const isSlotInFuture = (slot: Slot, slotConfig: SlotConfig): boolean => {
  const currentTime = nowFn()
  const slotTime = slotToUnixTime(slot, slotConfig)
  return slotTime > currentTime
}

/**
 * Check if a slot is in the past relative to current time.
 *
 * @param slot - The slot to check
 * @param slotConfig - The network's slot configuration
 * @returns True if the slot is in the past
 *
 * @category Utility
 * @since 2.0.0
 */
export const isSlotInPast = (slot: Slot, slotConfig: SlotConfig): boolean => {
  const currentTime = nowFn()
  const slotTime = slotToUnixTime(slot, slotConfig)
  return slotTime < currentTime
}

/**
 * Get the slot at a specific offset from now (in milliseconds).
 *
 * @param offsetMs - Offset in milliseconds (positive for future, negative for past)
 * @param network - The network
 * @returns Slot number at the offset time
 *
 * @category Utility
 * @since 2.0.0
 *
 * @example
 * ```typescript
 * import * as Time from "@evolution-sdk/evolution/Time"
 *
 * // Get slot 5 minutes from now
 * const futureSlot = Time.getSlotAt(5 * 60 * 1000, "Mainnet")
 *
 * // Get slot 10 minutes ago
 * const pastSlot = Time.getSlotAt(-10 * 60 * 1000, "Mainnet")
 * ```
 */
export const getSlotAt = (offsetMs: number, network: Network.Network): Slot => {
  const config = SLOT_CONFIG_NETWORK[network]
  const targetTime = nowFn() + BigInt(offsetMs)
  return unixTimeToSlot(targetTime, config)
}
