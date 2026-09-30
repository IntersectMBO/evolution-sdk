/**
 * Shared preprod network constants for provider integration tests.
 *
 * These are known, stable values on the Cardano preprod testnet
 * used to verify providers return correct data for real on-chain state.
 *
 * Branded types are constructed lazily so module import never throws —
 * a parsing error only surfaces when a skipped test is actually enabled.
 */

import * as Address from "../../../src/Address.js"
import * as DatumHash from "../../../src/DatumHash.js"
import * as RewardAddress from "../../../src/RewardAddress.js"
import * as TransactionHash from "../../../src/TransactionHash.js"
import * as TransactionInput from "../../../src/TransactionInput.js"

// ── Raw strings ──────────────────────────────────────────────

/** Funded address (~4800+ ADA, used by a preprod oracle operator) */
export const PREPROD_ADDRESS_BECH32 =
  "addr_test1vrqrt84m05rg34usvj73rryeezu8kkznuwh4jfzmh9lgf5swrdhze"

/** Stake address delegated to pool1mp96… with rewards */
export const PREPROD_STAKE_ADDRESS_BECH32 =
  "stake_test1upxue2rk4tp0e3tp7l0nmfmj6ar7y9yvngzu0vn7fxs9ags2apttt"

/** Confirmed preprod tx (oracle feed update) */
export const PREPROD_TX_HASH_HEX =
  "23f94840ca94f7bb0a5a2b28e5b6a77e61d0414c7427e03d6c4d57b13d5e49b4"

/** Preview-only tx whose collateral output has a Haskell show string asset_list.
 *  Does NOT exist on preprod — used to test awaitTx timeout behavior AND Koios
 *  asset_list string decoding (collateral outputs with many assets). */
export const PREVIEW_TX_HASH_HEX =
  "bfab055361b02a6da919525bfd0447773c640c4e7d65e84783fb3f3b03675688"

/** Datum hash from the oracle UTxO above */
export const PREPROD_DATUM_HASH_HEX =
  "facfe6aa45fa8023a97a3f13afb823f3966313533f6d68821e65d8431b5a4918"

/** Oracle NFT: policy c13ddf…2360 + name PREPROD_ORACLE (on the script address) */
export const PREPROD_UNIT =
  "c13ddf298a5d25aff2933695987912b4f1748bdf0df8e4b5d85f236050524550524f445f4f5241434c45"

/** Script address holding the oracle NFT + datum */
export const PREPROD_SCRIPT_ADDRESS_BECH32 =
  "addr_test1wz7uytdxstxe4nhdtl2gj9rcnlyce99tc707mz6qewxyx9qac0urr"

// ── Branded types (lazy — only constructed when accessed) ────
export const preprodAddress = () => Address.fromBech32(PREPROD_ADDRESS_BECH32)

export const preprodScriptAddress = () => Address.fromBech32(PREPROD_SCRIPT_ADDRESS_BECH32)

export const preprodStakeAddress = () =>
  RewardAddress.RewardAddress.make(PREPROD_STAKE_ADDRESS_BECH32)

export const preprodTxHash = () => TransactionHash.fromHex(PREPROD_TX_HASH_HEX)

export const previewTxHash = () => TransactionHash.fromHex(PREVIEW_TX_HASH_HEX)

export const preprodDatumHash = () => DatumHash.fromHex(PREPROD_DATUM_HASH_HEX)

export const preprodOutRef = () =>
  new TransactionInput.TransactionInput({
    transactionId: preprodTxHash(),
    index: 0n,
  })
