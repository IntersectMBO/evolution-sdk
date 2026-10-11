import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as AuxiliaryData from "../src/AuxiliaryData.js"
import * as AuxiliaryDataHash from "../src/AuxiliaryDataHash.js"
import type * as CBOR from "../src/CBOR.js"
import * as Metadata from "../src/Metadata.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionMetadatum from "../src/TransactionMetadatum.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

/**
 * The builder returns a `Transaction`, not bytes, so the CALLER chooses the encoding afterwards.
 * But `auxiliary_data_hash` and `script_data_hash` are computed over serialized bytes DURING the
 * build, and the fee follows the serialized size.
 *
 * ⚠️ With no say in the matter all three used `CML_DEFAULT_OPTIONS`, so a transaction encoded
 * canonically afterwards carried hashes taken over bytes it would never be encoded as. The node
 * rejects that; `cardano-hw-cli` refuses to witness it even earlier, because it treats a
 * non-canonical encoding as a *fixable* issue — which is why no hardware wallet could be handed a
 * canonically-encoded transaction from this builder.
 *
 * Metadata is the cheapest place to see it: a map whose keys are not in canonical order encodes
 * differently under the two option sets, so the hash over it differs.
 */
const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const baseConfig = { chain: mainnet }

const walletUtxo = createCoreTestUtxo({
  transactionId: "a".repeat(64),
  index: 0n,
  address: CHANGE_ADDRESS,
  lovelace: 100_000_000n
})

/** A metadatum map whose keys are NOT in canonical order, which is where the options bite. */
const metadatum = TransactionMetadatum.fromCBORHex("a2026161016162")

const buildWith = async (codecOptions?: CBOR.CodecOptions) => {
  const signBuilder = await makeTxBuilder(baseConfig)
    .attachMetadata({ label: Metadata.MetadataLabel.make(722n), metadata: metadatum })
    .payToAddress({
      address: CoreAddress.fromBech32(CHANGE_ADDRESS),
      assets: CoreAssets.fromLovelace(2_000_000n)
    })
    .build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [walletUtxo],
      protocolParameters: PROTOCOL_PARAMS,
      ...(codecOptions ? { codecOptions } : {})
    })
  return signBuilder.toTransaction()
}

describe("the builder hashes under the options it will be serialized with", () => {
  it("embeds a different auxiliary_data_hash under canonical encoding", async () => {
    const underDefaults = await buildWith()
    const underCanonical = await buildWith({ mode: "canonical" })

    expect(underDefaults.body.auxiliaryDataHash).toBeDefined()
    expect(underCanonical.body.auxiliaryDataHash).toBeDefined()
    // ⚠️ This is the defect. Before `codecOptions` existed these two were identical, and the one
    // meant for canonical encoding was a hash over bytes the transaction would never carry.
    expect(AuxiliaryDataHash.toHex(underCanonical.body.auxiliaryDataHash!)).not.toBe(
      AuxiliaryDataHash.toHex(underDefaults.body.auxiliaryDataHash!)
    )
  })

  it("embeds exactly the hash recomputed over its OWN auxiliary data under those options", async () => {
    for (const options of [undefined, { mode: "canonical" } as const]) {
      const tx = await buildWith(options)
      expect(tx.auxiliaryData).not.toBeNull()
      const recomputed = AuxiliaryDataHash.toHex(AuxiliaryData.toHash(tx.auxiliaryData!, options))
      expect(AuxiliaryDataHash.toHex(tx.body.auxiliaryDataHash!)).toBe(recomputed)
    }
  })

  /**
   * ⚠️ The hashes are only half of it. Every provider submits with a bare
   * `Transaction.toCBORBytes(tx)`, so without this the transaction would be re-encoded under the
   * CML defaults on the way out and the bytes sent would not match the hashes inside them.
   */
  it("serializes under those options by default, which is what providers call", async () => {
    const tx = await buildWith({ mode: "canonical" })
    const asSubmitted = Transaction.toCBORHex(tx)
    const explicitlyCanonical = Transaction.toCBORHex(tx, { mode: "canonical" })
    expect(asSubmitted).toBe(explicitlyCanonical)
  })

  it("leaves a default-built transaction serializing exactly as before", async () => {
    const tx = await buildWith()
    expect(Transaction.toCBORHex(tx)).toBe(Transaction.toCBORHex(tx, undefined))
    expect(Transaction.getIntendedCodecOptions(tx)).toBeUndefined()
  })

  it("leaves the default build byte-identical to before the option existed", async () => {
    // Omitting `codecOptions` must change nothing: this is opt-in, and every existing caller
    // depends on the CML-default behaviour.
    const a = await buildWith()
    const b = await buildWith(undefined)
    expect(AuxiliaryDataHash.toHex(a.body.auxiliaryDataHash!)).toBe(
      AuxiliaryDataHash.toHex(b.body.auxiliaryDataHash!)
    )
    expect(a.body.fee).toBe(b.body.fee)
  })
})
