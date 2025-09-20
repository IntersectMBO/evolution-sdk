import type * as Value from "../../../core/Value.js"
import type * as Address from "../../Address.js"
import type * as Assets from "../../Assets.js"
import type * as Script from "../../Script.js"
import type * as UTxO from "../../UTxO.js"

// ============================================================================
// Operation Parameter Types
// ============================================================================

export interface PayToAddressParams {
  readonly address: Address.Address // Mandatory: Recipient address
  readonly assets: Value.Value // Mandatory: ADA and/or native tokens to send
  readonly datum?: string // Optional: Inline datum
  readonly scriptRef?: Script.Script // Optional: Reference script to attach
}

export interface CollectFromParams {
  readonly inputs: ReadonlyArray<UTxO.UTxO> // Mandatory: UTxOs to consume as inputs
  readonly redeemer?: Redeemer.Redeemer // Optional: Redeemer for script inputs
}

export interface MintTokensParams {
  readonly assets: Assets.Assets // Mandatory: Tokens to mint (excluding lovelace)
  readonly redeemer?: Redeemer.Redeemer // Optional: Redeemer for minting script
}

// ============================================================================
// Operation Type Namespaces
// ============================================================================

export namespace Redeemer {
  export type Redeemer = string
}

export namespace ScriptHash {
  export type ScriptHash = string
}