import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as Address from "../src/Address.js"
import * as Derivation from "../src/sdk/wallet/Derivation.js"
import * as Wallet from "../src/sdk/wallet/Wallet.js"

const SEED_PHRASE =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

describe("Wallet runtime constructors", () => {
  it.effect("makePrivateKeyWalletEffect respects stake key and address type", () =>
    Effect.gen(function* () {
      const derived = yield* Derivation.walletFromSeed(SEED_PHRASE, {
        addressType: "Base",
        accountIndex: 0,
        networkId: 1
      })

      const baseEffects = Wallet.makePrivateKeyWalletEffect(1, derived.paymentKey, {
        stakeKey: derived.stakeKey,
        addressType: "Base"
      })
      const enterpriseEffects = Wallet.makePrivateKeyWalletEffect(1, derived.paymentKey, {
        addressType: "Enterprise"
      })

      const baseAddress = yield* baseEffects.address()
      const baseReward = yield* baseEffects.rewardAddress()
      const enterpriseAddress = yield* enterpriseEffects.address()
      const enterpriseReward = yield* enterpriseEffects.rewardAddress()

      expect(Address.toBech32(baseAddress)).toBe(Address.toBech32(derived.address))
      expect(baseReward).toBe(derived.rewardAddress)
      expect(Address.toBech32(enterpriseAddress)).toBe("addr1v98wl3hnya9l94rt58ky533deyqe9t8zz5n9su26k8e5g2srcn4hd")
      expect(enterpriseReward).toBeNull()
    })
  )

  it.effect("makeSigningWalletEffect.signMessage returns a real cms_ signature", () =>
    Effect.gen(function* () {
      const effects = Wallet.makeSigningWalletEffect(1, SEED_PHRASE)
      const address = yield* effects.address()
      const signed = yield* effects.signMessage(address, "hello world")

      expect(signed.payload).toBe("hello world")
      expect(signed.signature.startsWith("cms_")).toBe(true)
    })
  )
})
