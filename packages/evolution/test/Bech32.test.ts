import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bech32 from "../src/Bech32.js"

// A base address is 108 characters, longer than the 90-character BIP-173 default limit
const BASE_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

describe("Bech32", () => {
  it("decodes a base address longer than 90 characters", () => {
    const bytes = Schema.encodeSync(Bech32.FromBytes("addr_test"))(BASE_ADDRESS)
    expect(bytes.length).toBe(57)
    expect(Schema.decodeSync(Bech32.FromBytes("addr_test"))(bytes)).toBe(BASE_ADDRESS)
  })
})
