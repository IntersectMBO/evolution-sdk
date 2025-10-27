import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { walletFromSeed } from "../src/sdk/wallet/Derivation.js"

const seedPhrase =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

describe("WalletFromSeed", () => {
  it.effect("Defaults options", () =>
    Effect.gen(function* () {
      const result1 = yield* walletFromSeed(seedPhrase, {
        addressType: "Base",
        accountIndex: 0,
        network: "Mainnet"
      })
      
      expect(result1.address).toBe("addr1q98wl3hnya9l94rt58ky533deyqe9t8zz5n9su26k8e5g23yar4q0adtaax9q9g0kphpv2ws7vxqwu6ln6pqx7j29nfqsfy9mg")
      expect(result1.rewardAddress).toBe("stake1uyjw36s87k477nzsz58mqmsk98g0xrq8wd0eaqsr0f9ze5s48wtl9")
      expect(result1.paymentKey).toBe("ed25519e_sk1krszcw3ujfs3qnsjwl6wynw7dwudgnq69w9lrrtdf46yqnd25dgv4f5ttaqxr2v6n6azee489c7mryudvhu8n4x4tcvd5hvhtwswsuc4s4c2d")
      expect(result1.stakeKey).toBe("ed25519e_sk19q4d6fguvncszk6f46fvvep5y5w3877y77t3n3dc446wgja25dg968hm8jxkc9d7p982uls6k8uq0srs69e44lay43hxmdx4nc3rttsn0h2f5")

      const result2 = yield* walletFromSeed(seedPhrase)
      expect(result2.address).toBe(result1.address)
      expect(result2.rewardAddress).toBe(result1.rewardAddress)
      expect(result2.paymentKey).toBe(result1.paymentKey)
      expect(result2.stakeKey).toBe(result1.stakeKey)
    })
  )

  it.effect("accountIndex 1", () =>
    Effect.gen(function* () {
      const result1 = yield* walletFromSeed(seedPhrase, {
        addressType: "Base",
        accountIndex: 1,
        network: "Mainnet"
      })
      
      expect(result1.address).toBe("addr1q8833yrnksyq3v3u582g8pkzzdmg9yge7lftvu8lj6lakmp7e5x8vl3sqdtxra9z9p95k27kx2njgqux86d5mtfc2t8sa7jy78")
      expect(result1.rewardAddress).toBe("stake1uylv6rrk0ccqx4np7j3zsj6t90tr9feyqwrrax6d45u99nce2rkhr")
      expect(result1.paymentKey).toBe("ed25519e_sk1tzqvdwc8kr9zk4fmlwhexzpgcgx8t35zls2ckeswehpdsja25dg9j998sp9s2xy0aeyrdquhpljwfgghz9e78wqux8xj9t2p8z59ahc75nyyr")
      expect(result1.stakeKey).toBe("ed25519e_sk1trauywg7p9x2hg3jgaw2adeyg5ujhax4jfd6exs6hpzakn925dggyvhgrh8kwc9h9n7nh75nwhge9gyxg7vavcwk7mq3r2t03664drcrdegzx")

      const result2 = yield* walletFromSeed(seedPhrase, {
        accountIndex: 1
      })
      expect(result2.address).toBe(result1.address)
      expect(result2.rewardAddress).toBe(result1.rewardAddress)
      expect(result2.paymentKey).toBe(result1.paymentKey)
      expect(result2.stakeKey).toBe(result1.stakeKey)
    })
  )

  it.effect("Custom Network", () =>
    Effect.gen(function* () {
      const result1 = yield* walletFromSeed(seedPhrase, {
        addressType: "Base",
        accountIndex: 0,
        network: "Custom"
      })
      
      expect(result1.address).toBe("addr_test1qp8wl3hnya9l94rt58ky533deyqe9t8zz5n9su26k8e5g23yar4q0adtaax9q9g0kphpv2ws7vxqwu6ln6pqx7j29nfqnle9hh")
      expect(result1.rewardAddress).toBe("stake_test1uqjw36s87k477nzsz58mqmsk98g0xrq8wd0eaqsr0f9ze5sjdyfmc")
      expect(result1.paymentKey).toBe("ed25519e_sk1krszcw3ujfs3qnsjwl6wynw7dwudgnq69w9lrrtdf46yqnd25dgv4f5ttaqxr2v6n6azee489c7mryudvhu8n4x4tcvd5hvhtwswsuc4s4c2d")
      expect(result1.stakeKey).toBe("ed25519e_sk19q4d6fguvncszk6f46fvvep5y5w3877y77t3n3dc446wgja25dg968hm8jxkc9d7p982uls6k8uq0srs69e44lay43hxmdx4nc3rttsn0h2f5")

      const result2 = yield* walletFromSeed(seedPhrase, {
        network: "Custom"
      })
      expect(result2.address).toBe(result1.address)
      expect(result2.rewardAddress).toBe(result1.rewardAddress)
      expect(result2.paymentKey).toBe(result1.paymentKey)
      expect(result2.stakeKey).toBe(result1.stakeKey)
    })
  )

  it.effect("Address Enterprise", () =>
    Effect.gen(function* () {
      const result1 = yield* walletFromSeed(seedPhrase, {
        addressType: "Enterprise",
        accountIndex: 0,
        network: "Mainnet"
      })
      
      expect(result1.address).toBe("addr1v98wl3hnya9l94rt58ky533deyqe9t8zz5n9su26k8e5g2srcn4hd")
      expect(result1.rewardAddress).toBeUndefined()
      expect(result1.paymentKey).toBe("ed25519e_sk1krszcw3ujfs3qnsjwl6wynw7dwudgnq69w9lrrtdf46yqnd25dgv4f5ttaqxr2v6n6azee489c7mryudvhu8n4x4tcvd5hvhtwswsuc4s4c2d")
      expect(result1.stakeKey).toBeUndefined()

      const result2 = yield* walletFromSeed(seedPhrase, {
        addressType: "Enterprise"
      })
      expect(result2.address).toBe(result1.address)
      expect(result2.rewardAddress).toBeUndefined()
      expect(result2.paymentKey).toBe(result1.paymentKey)
      expect(result2.stakeKey).toBeUndefined()
    })
  )
})
