import {
  Assets,
  BaseAddress,
  Bytes,
  CBOR,
  Credential as EvoCredential,
  Data,
  EnterpriseAddress,
  RewardAccount
} from "@evolution-sdk/evolution"
import { Brands } from "@evolution-sdk/review"

import type { Credential, KeyHashHex,Network } from "../Types.js"
import { PlutusDataHex } from "../Types.js"

/**
 * The byte operations CIP-113 needs, over Evolution.
 *
 * Each one is held against an independently written pure-TypeScript codec, byte for byte, by a
 * standing conformance gate over all 108 operations. They are inlined here rather than reached
 * through a codec service because a tier that no longer needs a swappable codec should not
 * require one.
 *
 * @since 0.1.0
 */

// ── Plutus data ────────────────────────────────────────────────────────────────

/**
 * A Plutus list from already-encoded item bytes.
 *
 * ⚠️ Non-empty is INDEFINITE-framed and empty is definite — the rule Evolution's own encoder
 * applies, but applied here WITHOUT decoding the children, so each item keeps the framing it
 * arrived with. Re-deriving a child reframes an empty Plutus array, and a datum that
 * re-encodes differently hashes differently — which, for a registry node, moves the node's
 * own datum hash and therefore what the validator reads.
 */
/** @since 0.1.0 */
export const plutusDataInt = (dec: string): PlutusDataHex => PlutusDataHex(Data.toCBORHex(Data.int(BigInt(dec))))

/**
 * A Plutus bytestring.
 *
 * ⚠️ Through `Data.bytearray`, not a raw CBOR byte string: the Plutus CDDL is
 * `bounded_bytes`, so a value over 64 bytes is CHUNKED. Encoding it as one string is
 * different bytes, and the ledger reads the chunked form.
 */
export const plutusDataBytes = (dataHex: string): PlutusDataHex =>
  PlutusDataHex(Data.toCBORHex(Data.bytearray(dataHex)))

/** @since 0.1.0 */
export const plutusDataList = (itemHexes: ReadonlyArray<string>): PlutusDataHex =>
  PlutusDataHex(Bytes.toHex(Data.spliceList(itemHexes.map((h) => Bytes.fromHex(h)))))

/** @since 0.1.0 */
export const plutusDataConstr = (alt: bigint, fieldHexes: ReadonlyArray<string>): PlutusDataHex =>
  PlutusDataHex(Bytes.toHex(Data.spliceConstr(alt, fieldHexes.map((h) => Bytes.fromHex(h)))))

/** ⚠️ Definite-framed, and the entries keep the order given — a Plutus map is not sorted. */
export const plutusDataMap = (
  keyHexes: ReadonlyArray<string>,
  valHexes: ReadonlyArray<string>
): PlutusDataHex =>
  PlutusDataHex(
    Bytes.toHex(Data.spliceMap(keyHexes.map((k, i) => [Bytes.fromHex(k), Bytes.fromHex(valHexes[i]!)])))
  )

// ── values ─────────────────────────────────────────────────────────────────────

/**
 * An asset bag from an ada amount and CIP-113's dotted asset ids.
 *
 * ⚠️ `Assets.fromRecord` reads BOTH unit spellings -- the joined `policyId+assetName` it emits
 * itself and the dotted `policyId.assetName` CIP-113 carries -- so the dotted ids go straight in.
 * The two used to disagree, silently, by answering `0n` for an asset that was present.
 *
 * An empty asset list is a coin-only bag, not an error: an ada-only output reaches this on the
 * same path as one carrying a node NFT.
 *
 * @since 0.1.0
 */
export const assetsOf = (
  coin: bigint,
  assetIds: ReadonlyArray<string>,
  amounts: ReadonlyArray<bigint>
): Assets.Assets =>
  Assets.fromRecord(
    assetIds.reduce<Record<string, bigint>>((acc, id, i) => ({ ...acc, [id]: amounts[i]! }), { lovelace: coin })
  )

// ── body field 14 ──────────────────────────────────────────────────────────────

/**
 * `required_signers` (body key 14) — a tag-258 set of 28-byte key hashes.
 *
 * ⚠️ The set is ALWAYS tag-258 here. Conway accepts a bare array too, and the two are
 * different bytes and therefore a different transaction id; a builder that emits one shape
 * and a reviewer that assumes the other disagree about what was signed.
 */
export const requiredSigners = (hashHexes: ReadonlyArray<KeyHashHex>): string =>
  Bytes.toHex(
    CBOR.encodeTaggedValue(
      258,
      CBOR.encodeArrayAsDefinite(hashHexes.map((h) => CBOR.toCBORBytes(Bytes.fromHex(h))))
    )
  )

// ── addresses ──────────────────────────────────────────────────────────────────

const credentialOf = (c: Credential) =>
  c.kind === "script"
    ? EvoCredential.makeScriptHash(Bytes.fromHex(c.hashHex))
    : EvoCredential.makeKeyHash(Bytes.fromHex(c.hashHex))

/** Enterprise address (script payment credential, no stake credential). @since 0.1.0 */
export const enterpriseScriptHex = (net: Network, scriptHashHex: string): Brands.AddressHex =>
  Brands.AddressHex(
    EnterpriseAddress.toHex(
      new EnterpriseAddress.EnterpriseAddress({
        networkId: net,
        paymentCredential: EvoCredential.makeScriptHash(Bytes.fromHex(scriptHashHex))
      })
    )
  )

/**
 * Base address with a SCRIPT payment credential and `stakeCred` as the stake credential.
 *
 * This is the smart-wallet shape: the payment credential is the shared PLB script, and the
 * STAKE credential is what identifies the holder. `stakeCred.kind` selects the header type
 * (key → type 1, script → type 3).
 *
 * @since 0.1.0
 */
export const baseScriptHex = (net: Network, scriptHashHex: string, stakeCred: Credential): Brands.AddressHex =>
  Brands.AddressHex(
    BaseAddress.toHex(
      new BaseAddress.BaseAddress({
        networkId: net,
        paymentCredential: EvoCredential.makeScriptHash(Bytes.fromHex(scriptHashHex)),
        stakeCredential: credentialOf(stakeCred)
      })
    )
  )

/** Reward (stake) address with a SCRIPT stake credential — a withdraw-zero account. @since 0.1.0 */
export const rewardScriptHex = (net: Network, stakeScriptHashHex: string): string =>
  RewardAccount.toHex(
    new RewardAccount.RewardAccount({
      networkId: net,
      stakeCredential: EvoCredential.makeScriptHash(Bytes.fromHex(stakeScriptHashHex))
    })
  )

