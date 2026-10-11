/**
 * Nominal brands for the hex strings the wallet packages hand back.
 *
 * They exist so a caller cannot pass a transaction hash where an address hex belongs: both are
 * `string`, both are hex, and the type system is the only thing standing between them.
 *
 * ⚠️ **One home, on purpose.** These were defined twice — here and in `@evolution-sdk/cip113` —
 * which is harmless while both spell the brand identically (`Brand.Brand<"ValueHex">` is structural,
 * so the two were interchangeable) and a silent divergence the moment one is renamed. `cip113`
 * re-exports from here now.
 *
 * @since 0.1.0
 */

/**
 * ⚠️ **Two kinds of brand live here, and they are constructed differently.**
 *
 * The *shaped* ones — hashes, keys, addresses — **validate**. A 28-byte key hash, a 32-byte
 * transaction hash and a bech32 address all have a shape worth checking, and checking it at the
 * line that builds the value is the whole point: `TxHashHex("zz")` used to succeed and surface
 * wherever those bytes were finally used.
 *
 * The *opaque* ones — {@link ValueHex}, {@link ScriptHex}, {@link PlutusDataHex} — stay
 * `Brand.nominal` casts. They are CBOR of arbitrary length, so the only check available is "even
 * number of hex digits", which rejects almost nothing real. It does, however, break test doubles
 * that carry a readable stand-in instead of a real encoding — and a plan-arithmetic test that has
 * to encode genuine CBOR to say "100 of this token" is a worse test, not a safer one.
 */

/**
 * ⚠️ These are now **aliases of Evolution's branded hex**, not separate brands:
 * One definition, shared by both trees,
 * so a value crossing between them keeps its identity instead of being re-asserted.
 *
 * The *constructors* here deliberately stay `Brand.nominal` — assertions that do not check.
 * Evolution's `Hex.make` validates, and switching ~1,800 existing call sites to a validating
 * constructor in one step would impose validation on a boundary that has never had any: the
 * failures would arrive one at a time, at runtime, on the path that moves funds. Tightening the
 * constructor is its own change, made where the call sites can be read.
 */

import * as EvAddress from "@evolution-sdk/evolution/Address"
import * as EvAssetName from "@evolution-sdk/evolution/AssetName"
import * as EvAuxiliaryDataHash from "@evolution-sdk/evolution/AuxiliaryDataHash"
import * as EvBip32PrivateKey from "@evolution-sdk/evolution/Bip32PrivateKey"
import * as EvBip32PublicKey from "@evolution-sdk/evolution/Bip32PublicKey"
import type * as EvData from "@evolution-sdk/evolution/Data"
import * as EvDatumHash from "@evolution-sdk/evolution/DatumHash"
import * as EvEd25519Signature from "@evolution-sdk/evolution/Ed25519Signature"
import * as EvKeyHash from "@evolution-sdk/evolution/KeyHash"
import * as EvPolicyId from "@evolution-sdk/evolution/PolicyId"
import type * as EvScript from "@evolution-sdk/evolution/Script"
import * as EvScriptDataHash from "@evolution-sdk/evolution/ScriptDataHash"
import * as EvTransactionHash from "@evolution-sdk/evolution/TransactionHash"
import type * as EvValue from "@evolution-sdk/evolution/Value"
import * as EvVKey from "@evolution-sdk/evolution/VKey"
import { Brand } from "effect"

/** An address as raw hex — not bech32. @since 0.1.0 */
export type AddressHex = EvAddress.Hex
/** @since 0.1.0 */
export const AddressHex = (value: string): AddressHex => EvAddress.Hex.make(value)

/** A bech32-encoded address. @since 0.1.0 */
export type Bech32 = EvAddress.Bech32
/** @since 0.1.0 */
export const Bech32 = (value: string): Bech32 => EvAddress.Bech32.make(value)

/** A 32-byte transaction hash as hex. @since 0.1.0 */
export type TxHashHex = EvTransactionHash.Hex
/** @since 0.1.0 */
export const TxHashHex = (value: string): TxHashHex => EvTransactionHash.Hex.make(value)

/** A `Value` as CBOR hex. @since 0.1.0 */
export type ValueHex = EvValue.Hex
/** @since 0.1.0 */
export const ValueHex = Brand.nominal<ValueHex>()

/** A 28-byte key or script hash as hex. @since 0.1.0 */
export type KeyHashHex = EvKeyHash.Hex
/** @since 0.1.0 */
export const KeyHashHex = (value: string): KeyHashHex => EvKeyHash.Hex.make(value)

/** A script's `compiledCode` as hex, parameters already applied. @since 0.1.0 */
export type ScriptHex = EvScript.Hex
/** @since 0.1.0 */
export const ScriptHex = Brand.nominal<ScriptHex>()

/** A `plutus_data` item as CBOR hex. @since 0.1.0 */
export type PlutusDataHex = EvData.Hex
/** @since 0.1.0 */
export const PlutusDataHex = Brand.nominal<PlutusDataHex>()

/**
 * A BIP32-Ed25519 extended PUBLIC key as hex (64 bytes: 32 key + 32 chain code).
 *
 * ⚠️ Branded apart from {@link XprvHex} because the two are the same shape and swapping them is
 * unrecoverable in one direction: publishing where a private key was expected is merely wrong,
 * while signing with what you believed was public is a leaked key.
 *
 * @since 0.1.0
 */
export type XpubHex = EvBip32PublicKey.Hex
/** @since 0.1.0 */
export const XpubHex = (value: string): XpubHex => EvBip32PublicKey.Hex.make(value)

/** A BIP32-Ed25519 extended PRIVATE key as hex (96 bytes). See {@link XpubHex}. @since 0.1.0 */
export type XprvHex = EvBip32PrivateKey.Hex
/** @since 0.1.0 */
export const XprvHex = (value: string): XprvHex => EvBip32PrivateKey.Hex.make(value)

/**
 * A minting policy id: the 28-byte hash of the minting script.
 *
 * ⚠️ Branded apart from {@link KeyHashHex} even though both are 28-byte hashes, because a policy
 * id and a payment credential are the two things most often in scope together when an asset is
 * being built, and the ledger rejects the swap only after a transaction has been signed.
 *
 * @since 0.1.0
 */
export type PolicyIdHex = EvPolicyId.Hex
/** @since 0.1.0 */
export const PolicyIdHex = (value: string): PolicyIdHex => EvPolicyId.Hex.make(value)

/**
 * An asset name as hex: 0 to 32 arbitrary bytes, **not** a hash.
 *
 * ⚠️ The other half of an asset id, and the one swap the type system can catch: a policy id and an
 * asset name sit in the same object, are both hex, and an empty asset name is legal — so a
 * transposition produces a well-formed value for an asset that does not exist.
 *
 * @since 0.1.0
 */
export type AssetNameHex = EvAssetName.Hex
/** @since 0.1.0 */
export const AssetNameHex = (value: string): AssetNameHex => EvAssetName.Hex.make(value)

/**
 * A datum hash as hex: blake2b-256 of a `plutus_data` item.
 *
 * @since 0.1.0
 */
export type DatumHashHex = EvDatumHash.Hex
/** @since 0.1.0 */
export const DatumHashHex = (value: string): DatumHashHex => EvDatumHash.Hex.make(value)

/**
 * An `auxiliary_data_hash` as hex (body key 7).
 *
 * ⚠️ One of four unrelated 32-byte hashes a body carries, alongside {@link TxHashHex},
 * {@link DatumHashHex} and {@link ScriptDataHashHex}. They are mutually substitutable as strings
 * and each mis-assignment is a node rejection that names the wrong field.
 *
 * @since 0.1.0
 */
export type AuxiliaryDataHashHex = EvAuxiliaryDataHash.Hex
/** @since 0.1.0 */
export const AuxiliaryDataHashHex = (value: string): AuxiliaryDataHashHex => EvAuxiliaryDataHash.Hex.make(value)

/** A `script_data_hash` as hex (body key 11). See {@link AuxiliaryDataHashHex}. @since 0.1.0 */
export type ScriptDataHashHex = EvScriptDataHash.Hex
/** @since 0.1.0 */
export const ScriptDataHashHex = (value: string): ScriptDataHashHex => EvScriptDataHash.Hex.make(value)

/**
 * A plain 32-byte Ed25519 public key as hex, as a `vkeywitness` carries it.
 *
 * ⚠️ Not {@link XpubHex}, which is the 64-byte BIP32 extended form (key + chain code). A verifier
 * handed the extended form where this belongs fails on every signature.
 *
 * @since 0.1.0
 */
export type PublicKeyHex = EvVKey.Hex
/** @since 0.1.0 */
export const PublicKeyHex = (value: string): PublicKeyHex => EvVKey.Hex.make(value)

/**
 * A 64-byte Ed25519 signature as hex.
 *
 * ⚠️ Branded apart from {@link PublicKeyHex} because a `vkeywitness` holds exactly these two, in
 * that order, and transposing them yields a witness that is structurally valid and verifies
 * against nothing.
 *
 * @since 0.1.0
 */
export type SignatureHex = EvEd25519Signature.Hex
/** @since 0.1.0 */
export const SignatureHex = (value: string): SignatureHex => EvEd25519Signature.Hex.make(value)
