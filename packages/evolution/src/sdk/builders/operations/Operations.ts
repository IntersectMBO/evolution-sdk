import type * as Address from "../../Address.js"
import type * as Assets from "../../Assets.js"
import type * as Datum from "../../Datum.js"
import type * as Script from "../../Script.js"
import type * as UTxO from "../../UTxO.js"

// ============================================================================
// Operation Parameter Types
// ============================================================================

export interface PayToAddressParams {
  readonly address: Address.Address // Mandatory: Recipient address
  readonly assets: Assets.Assets // Mandatory: ADA and/or native tokens to send
  readonly datum?: Datum.Datum // Optional: Datum to attach for script addresses
  readonly scriptRef?: Script.Script // Optional: Reference script to attach
}

export interface CollectFromParams {
  readonly inputs: ReadonlyArray<UTxO.UTxO> // Mandatory: UTxOs to consume as inputs
  readonly redeemer?: string
}

export interface MintTokensParams {
  readonly assets: Assets.Assets // Mandatory: Tokens to mint (excluding lovelace)
  readonly redeemer?: string // Optional: Redeemer for minting script
}