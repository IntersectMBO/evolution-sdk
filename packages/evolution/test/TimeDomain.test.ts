import { describe, expect, it } from "vitest"

import * as SlotConfig from "../src/SlotConfig.js"
import * as Time from "../src/Time.js"

/**
 * A `SlotConfig` describes ONE era with ONE slot length — its own fields say "Shelley era".
 * Outside that era the arithmetic still produces a number, and that number is wrong: mainnet
 * slot 0 is Byron, where slots were 20 seconds, and extrapolating 1-second slots backwards put
 * it 988 days late. A wrong date is worse than no date, because nothing downstream can tell it
 * from a real one.
 */
describe("Time conversions refuse what their configuration does not describe", () => {
  const mainnet = SlotConfig.getSlotConfig("Mainnet")

  it("converts Shelley-era slots, which is its domain", () => {
    expect(Time.slotToUnixTime(mainnet.zeroSlot, mainnet)).toBe(mainnet.zeroTime)
    expect(Time.slotToUnixTime(mainnet.zeroSlot + 1n, mainnet)).toBe(mainnet.zeroTime + 1000n)
    expect(Time.unixTimeToSlot(mainnet.zeroTime, mainnet)).toBe(mainnet.zeroSlot)
  })

  it("round-trips inside its domain", () => {
    for (const slot of [mainnet.zeroSlot, mainnet.zeroSlot + 1n, mainnet.zeroSlot + 10_000_000n]) {
      expect(Time.unixTimeToSlot(Time.slotToUnixTime(slot, mainnet), mainnet)).toBe(slot)
    }
  })

  it("refuses a slot from before its first slot, rather than extrapolating into Byron", () => {
    expect(() => Time.slotToUnixTime(0n, mainnet)).toThrow(/earlier era/)
    expect(() => Time.slotToUnixTime(mainnet.zeroSlot - 1n, mainnet)).toThrow(/earlier era/)
  })

  it("refuses a time from before its start", () => {
    expect(() => Time.unixTimeToSlot(0n, mainnet)).toThrow(/earlier era/)
    expect(() => Time.unixTimeToSlot(mainnet.zeroTime - 1n, mainnet)).toThrow(/earlier era/)
  })

  // Preview has no Byron era, so its own genesis is slot 0 and nothing is below it.
  it("accepts slot 0 on a network whose configuration starts there", () => {
    const preview = SlotConfig.getSlotConfig("Preview")
    expect(() => Time.slotToUnixTime(preview.zeroSlot, preview)).not.toThrow()
  })

  // `Custom` ships as all zeros to be filled in. Unfilled, a slotLength of 0 is a division by
  // zero that still returns a number.
  it("refuses the unfilled Custom configuration instead of dividing by zero", () => {
    const custom = SlotConfig.getSlotConfig("Custom")
    expect(custom.slotLength).toBe(0)
    expect(() => Time.unixTimeToSlot(1n, custom)).toThrow(/must be filled in/)
    expect(() => Time.slotToUnixTime(1n, custom)).toThrow(/must be filled in/)
  })
})
