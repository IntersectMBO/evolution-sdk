/**
 * The byte operations the plan engine performs, straight onto Evolution.
 *
 * ⚠️ **This replaced a codec service, and the difference is the point.** The engine used to take a
 * `PlanCodec` -- a `Pick` of a 109-operation interface -- threaded through every public entry
 * point and every plugin, so that a second byte backend could be swapped in. There is no second
 * backend: the pure-TypeScript core it existed for is retired, and nothing outside this package
 * ever passed one. What is left is a handful of calls to the modules that own the bytes, with no
 * interface to keep in sync and nothing to thread.
 *
 * Hex in, hex out, because the engine's public model is hex: a plan carries `dataHex`,
 * `datumHex`, `bodyExtra: [key, hex]` from callers that build those from Plutus blueprints. The
 * conversion happens here, once per operation, instead of between every pair of them.
 *
 * @since 0.1.0
 */
import {
  AssetName,
  AuxiliaryData,
  AuxiliaryDataHash,
  Bip32PrivateKey,
  Bip32PublicKey,
  Bytes,
  CBOR,
  CostModel,
  Ed25519Signature,
  Mint,
  PolicyId,
  PrivateKey,
  Redeemers,
  RewardAccount,
  ScriptDataHash,
  Transaction,
  TransactionBody,
  TransactionHash,
  TransactionInput,
  TransactionWitnessSet,
  Withdrawals
} from "@evolution-sdk/evolution"

const bytes = (hex: string): Uint8Array => Bytes.fromHex(hex)
const items = (hexes: ReadonlyArray<string>): Array<Uint8Array> => hexes.map(bytes)

/** A transaction input as its own CBOR: `[tx_id, index]`. */
export const txInput = (txHashHex: string, index: bigint): string =>
  TransactionInput.toCBORHex(
    new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(txHashHex), index })
  )

/**
 * A `#6.258` set over already-encoded items.
 *
 * ⚠️ Always tagged. Conway accepts a bare array too and the two are different bytes, so a builder
 * that emits one shape and a reviewer that assumes the other disagree about what was signed.
 */
export const taggedSet = (itemHexes: ReadonlyArray<string>): string => Bytes.toHex(CBOR.encodeTaggedSet(items(itemHexes)))

/** A witness-set script field: a tagged set whose items are CBOR BYTE STRINGS wrapping each script. */
export const plutusScripts = (scriptHexes: ReadonlyArray<string>): string =>
  Bytes.toHex(CBOR.encodeTaggedSet(items(scriptHexes).map((s) => CBOR.toCBORBytes(s))))

/** A bare CBOR uint, for the body fields that are one. */
export const cborUint = (value: bigint): string => Bytes.toHex(CBOR.toCBORBytes(value))

/** A `bytes32` body field: the hash wrapped as a CBOR byte string. */
export const byteString32 = (hashHex: string): string => Bytes.toHex(CBOR.toCBORBytes(bytes(hashHex)))

/**
 * The withdrawals map.
 *
 * ⚠️ `Withdrawals` sorts its own keys canonically on encode. That is NOT the order a tag-3
 * redeemer pointer resolves against -- see `ledgerWithdrawalOrder` -- and the two differ only for
 * a transaction mixing key- and script-credential reward accounts.
 */
export const withdrawals = (entries: ReadonlyArray<readonly [rewardAcctHex: string, amount: bigint]>): string =>
  Withdrawals.toCBORHex(
    Withdrawals.fromEntries(entries.map(([acct, amount]) => [RewardAccount.fromHex(acct), amount]))
  )

/**
 * The mint field, from `policyHex.nameHex` asset ids and signed amounts.
 *
 * ⚠️ `Mint` writes its policy map in canonical byte order, which is also the order a tag-1
 * redeemer pointer indexes -- the engine's `mintPolicyOrder` has to agree with it.
 */
export const mint = (entries: ReadonlyArray<readonly [assetId: string, amount: bigint]>): string => {
  const parsed = entries.map(([assetId, amount]) => {
    const dot = assetId.indexOf(".")
    const policy = dot < 0 ? assetId : assetId.slice(0, dot)
    const name = dot < 0 ? "" : assetId.slice(dot + 1)
    return { policy, name, amount }
  })
  const first = parsed[0]
  if (first === undefined) throw new Error("mint: no assets")
  let built = Mint.singleton(PolicyId.fromHex(first.policy), AssetName.fromHex(first.name), first.amount)
  for (const e of parsed.slice(1)) built = Mint.insert(built, PolicyId.fromHex(e.policy), AssetName.fromHex(e.name), e.amount)
  return Mint.toCBORHex(built)
}

/** The Conway redeemer map, with each redeemer's data spliced rather than re-encoded. */
export const redeemers = (
  entries: ReadonlyArray<{
    readonly tag: number
    readonly index: bigint
    readonly dataHex: string
    readonly mem: bigint
    readonly steps: bigint
  }>
): string =>
  Bytes.toHex(
    Redeemers.spliceMap(
      entries.map((r) => ({ tag: r.tag, index: r.index, data: bytes(r.dataHex), mem: r.mem, steps: r.steps }))
    )
  )

/**
 * `script_data_hash` over the redeemers and datums as they will actually be carried.
 *
 * ⚠️ `CostModels` requires all three languages, and `languageViewsEncoding` then skips the ones
 * with no costs -- so an absent language is an EMPTY model, not a missing field. A language id
 * outside 0/1/2 is refused rather than guessed: nothing defines the language view of an id that
 * does not exist, and a wrong `script_data_hash` is a phase-2 failure.
 */
export const scriptDataHash = (
  redeemersHex: string,
  datumsSetHex: string,
  costModels: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
): string => {
  const costs: Record<number, ReadonlyArray<bigint>> = { 0: [], 1: [], 2: [] }
  for (const m of costModels) {
    if (!(m.language in costs)) {
      throw new Error(`scriptDataHash: unknown Plutus language ${m.language} (Conway has 0, 1, 2)`)
    }
    costs[m.language] = [...m.costs]
  }
  const models = new CostModel.CostModels({
    PlutusV1: new CostModel.CostModel({ costs: costs[0]! }),
    PlutusV2: new CostModel.CostModel({ costs: costs[1]! }),
    PlutusV3: new CostModel.CostModel({ costs: costs[2]! })
  })
  return ScriptDataHash.toHex(
    Redeemers.toScriptDataHashFromEncoded(
      redeemersHex === "" ? new Uint8Array(0) : bytes(redeemersHex),
      datumsSetHex === "" ? undefined : bytes(datumsSetHex),
      models
    )
  )
}

/** `auxiliary_data_hash` over an already-built `auxiliary_data`. */
export const auxiliaryDataHash = (auxHex: string): string =>
  AuxiliaryDataHash.toHex(AuxiliaryData.toHash(AuxiliaryData.fromCBORHex(auxHex)))

/**
 * The body, from its inputs, outputs, fee, TTL and the `[key, hex]` fields the plugins produced.
 *
 * ⚠️ The input set is always `#6.258`-tagged; see {@link taggedSet}.
 */
export const body = (
  inputHexes: ReadonlyArray<string>,
  outputHexes: ReadonlyArray<string>,
  fee: bigint,
  ttl: bigint | undefined,
  fields: ReadonlyArray<readonly [number, string]>
): string =>
  TransactionBody.toCBORHex(
    TransactionBody.fromEncoded({
      inputs: items(inputHexes),
      outputs: items(outputHexes),
      fee,
      ...(ttl === undefined ? {} : { ttl }),
      fields: fields.map(([key, hex]) => [key, bytes(hex)] as const)
    })
  )

/** The signed transaction: body bytes, witnesses, native scripts, the witness-set fields, aux data. */
export const signedTx = (input: {
  readonly bodyHex: string
  readonly vkeyHexes: ReadonlyArray<string>
  readonly signatureHexes: ReadonlyArray<string>
  readonly nativeScriptHexes: ReadonlyArray<string>
  readonly witnessFields: ReadonlyArray<readonly [number, string]>
  readonly auxHex: string
}): string =>
  Transaction.toCBORHex(
    Transaction.fromEncoded({
      body: bytes(input.bodyHex),
      witnessSet: TransactionWitnessSet.fromEncoded({
        vkeyWitnesses: input.vkeyHexes.map((vk, i) => ({
          vkey: bytes(vk),
          signature: bytes(at(input.signatureHexes, i, "vkey_witness signature"))
        })),
        nativeScripts: items(input.nativeScriptHexes),
        fields: input.witnessFields.map(([key, hex]) => [key, bytes(hex)] as const)
      }),
      ...(input.auxHex === "" ? {} : { auxiliaryData: bytes(input.auxHex) })
    })
  )

/**
 * The body hash, over the bytes given.
 *
 * `toHashFromBytes` rather than decoding first: the two agree now that a decoded body replays its
 * arrival bytes, and hashing what we hold cannot disagree with it by construction.
 */
export const bodyHash = (bodyHex: string): string =>
  TransactionHash.toHex(TransactionBody.toHashFromBytes(bytes(bodyHex)))

/** The serialized size of an encoded transaction, in bytes. */
export const serializedSize = (hex: string): number => hex.length / 2

/**
 * The 32-byte Ed25519 public key of an extended private key, as a vkey witness carries it.
 *
 * ⚠️ Not the xpub: `toRawBytes` is the key alone, while `Bip32PublicKey.toHex` is 64 bytes, the
 * key followed by its chain code. A vkey witness built from the 64-byte form is not a witness.
 */
export const vkeyOf = (xprvHex: string): string =>
  Bytes.toHex(Bip32PublicKey.toRawBytes(Bip32PrivateKey.toPublicKey(Bip32PrivateKey.fromHex(xprvHex))))

/** An Ed25519 signature over `messageHex` by an extended private key. */
export const sign = (xprvHex: string, messageHex: string): string =>
  Ed25519Signature.toHex(PrivateKey.sign(Bip32PrivateKey.toPrivateKey(Bip32PrivateKey.fromHex(xprvHex)), bytes(messageHex)))

const at = <A>(xs: ReadonlyArray<A>, i: number, what: string): A => {
  const v = xs[i]
  if (v === undefined) throw new Error(`${what}: no value at index ${i}`)
  return v
}
