/**
 * The Ledger Cardano app's sign-request parameter shapes.
 *
 * Declared here rather than imported from `@cardano-foundation/ledgerjs-hw-app-cardano` so this
 * package builds a request without taking a dependency on the vendor SDK, on its transport, or
 * on a WebUSB/HID environment. The numeric values mirror that SDK's enums and are documented on
 * each type.
 *
 * @since 0.1.0
 */

/**
 * Address parameters for derivation.
 *
 * Matches the DeviceOwnedAddress type from @cardano-foundation/ledgerjs-hw-app-cardano.
 */
export type LedgerAddressParams = {
  /** Address type (numeric, matches SDK AddressType enum) */
  readonly type: LedgerAddressType
} & (
  | { readonly type: 0 | 1 | 2 | 3; readonly params: LedgerAddressParamsBase }
  | { readonly type: 6 | 7; readonly params: LedgerAddressParamsEnterprise }
  | { readonly type: 4 | 5; readonly params: LedgerAddressParamsPointer }
  | { readonly type: 14 | 15; readonly params: LedgerAddressParamsReward }
  | { readonly type: 8; readonly params: LedgerAddressParamsByron }
)

/** Byron address params. */
export type LedgerAddressParamsByron = {
  readonly spendingPath: ReadonlyArray<number>
}

/** Base address params (spending + staking). */
export type LedgerAddressParamsBase = {
  readonly spendingPath?: ReadonlyArray<number>
  readonly spendingScriptHashHex?: string
} & (
  | { readonly stakingPath: ReadonlyArray<number> }
  | { readonly stakingKeyHashHex: string }
  | { readonly stakingScriptHashHex: string }
)

/** Enterprise address params (spending only). */
export type LedgerAddressParamsEnterprise = {
  readonly spendingPath?: ReadonlyArray<number>
  readonly spendingScriptHashHex?: string
}

/** Pointer address params. */
export type LedgerAddressParamsPointer = {
  readonly spendingPath?: ReadonlyArray<number>
  readonly spendingScriptHashHex?: string
  readonly stakingBlockchainPointer: {
    readonly blockIndex: number
    readonly txIndex: number
    readonly certificateIndex: number
  }
}

/** Reward address params. */
export type LedgerAddressParamsReward =
  { readonly stakingPath: ReadonlyArray<number> } | { readonly stakingScriptHashHex: string }

/**
 * Ledger address types.
 * Numeric values matching SDK AddressType enum.
 */
export type LedgerAddressType =
  | 0 // BASE_PAYMENT_KEY_STAKE_KEY
  | 1 // BASE_PAYMENT_SCRIPT_STAKE_KEY
  | 2 // BASE_PAYMENT_KEY_STAKE_SCRIPT
  | 3 // BASE_PAYMENT_SCRIPT_STAKE_SCRIPT
  | 4 // POINTER_KEY
  | 5 // POINTER_SCRIPT
  | 6 // ENTERPRISE_KEY
  | 7 // ENTERPRISE_SCRIPT
  | 8 // BYRON
  | 14 // REWARD_KEY
  | 15 // REWARD_SCRIPT

/**
 * Transaction output destination types.
 * Must match @cardano-foundation/ledgerjs-hw-app-cardano TxOutputDestinationType enum values.
 */
export type LedgerOutputDestinationType = "third_party" | "device_owned"

/**
 * Ledger transaction input.
 */
export type LedgerTxInput = {
  /** Transaction hash hex */
  readonly txHashHex: string
  /** Output index */
  readonly outputIndex: number
  /** Path for signing (if owned) */
  readonly path?: ReadonlyArray<number>
}

/**
 * Ledger transaction output destination.
 */
export type LedgerTxOutputDestination =
  | {
      readonly type: "third_party"
      readonly params: { readonly addressHex: string }
    }
  | {
      readonly type: "device_owned"
      readonly params: LedgerAddressParams
    }

/**
 * Ledger datum (matches SDK Datum type).
 * Type is numeric: 0 = HASH, 1 = INLINE.
 */
export type LedgerDatum =
  { readonly type: 0; readonly datumHashHex: string } | { readonly type: 1; readonly datumHex: string }

/**
 * Ledger transaction output.
 * Matches SDK TxOutput (TxOutputAlonzo | TxOutputBabbage).
 */
export type LedgerTxOutput =
  | {
      /** Alonzo-era legacy format */
      readonly format?: 0
      readonly destination: LedgerTxOutputDestination
      readonly amount: string
      readonly tokenBundle?: ReadonlyArray<LedgerAssetGroup>
      /** Alonzo-style datum hash (legacy) */
      readonly datumHashHex?: string
    }
  | {
      /** Babbage-era map format */
      readonly format: 1
      readonly destination: LedgerTxOutputDestination
      readonly amount: string
      readonly tokenBundle?: ReadonlyArray<LedgerAssetGroup>
      readonly datum?: LedgerDatum
      readonly referenceScriptHex?: string
    }

/**
 * Ledger asset group.
 */
export type LedgerAssetGroup = {
  /** Policy ID hex */
  readonly policyIdHex: string
  /** Tokens in this policy */
  readonly tokens: ReadonlyArray<LedgerToken>
}

/**
 * Ledger token.
 */
export type LedgerToken = {
  /** Asset name hex */
  readonly assetNameHex: string
  /** Amount (can be negative for minting) */
  readonly amount: string
}

/**
 * Credential params matching SDK CredentialParams.
 * Type is numeric: 0 = KEY_PATH, 1 = KEY_HASH, 2 = SCRIPT_HASH.
 */
export type LedgerCredentialParams =
  | { readonly type: 0; readonly keyPath: ReadonlyArray<number> }
  | { readonly type: 1; readonly keyHashHex: string }
  | { readonly type: 2; readonly scriptHashHex: string }

/**
 * DRep params matching SDK DRepParams.
 * Type is numeric: 0 = KEY_PATH, 1 = KEY_HASH, 2 = SCRIPT_HASH, 3 = ABSTAIN, 4 = NO_CONFIDENCE.
 */
export type LedgerDRepParams =
  | { readonly type: 0; readonly keyPath: ReadonlyArray<number> }
  | { readonly type: 1; readonly keyHashHex: string }
  | { readonly type: 2; readonly scriptHashHex: string }
  | { readonly type: 3 }
  | { readonly type: 4 }

/**
 * Anchor params.
 */
export type LedgerAnchorParams = {
  readonly url: string
  readonly hashHex: string
}

/**
 * Ledger certificate types.
 * Matches SDK Certificate type with numeric CertificateType enum values
 * and nested params containing stakeCredential.
 */
export type LedgerCertificate =
  | {
      readonly type: 0 // STAKE_REGISTRATION
      readonly params: { readonly stakeCredential: LedgerCredentialParams }
    }
  | {
      readonly type: 1 // STAKE_DEREGISTRATION
      readonly params: { readonly stakeCredential: LedgerCredentialParams }
    }
  | {
      readonly type: 2 // STAKE_DELEGATION
      readonly params: { readonly stakeCredential: LedgerCredentialParams; readonly poolKeyHashHex: string }
    }
  | {
      readonly type: 7 // STAKE_REGISTRATION_CONWAY
      readonly params: { readonly stakeCredential: LedgerCredentialParams; readonly deposit: string }
    }
  | {
      readonly type: 8 // STAKE_DEREGISTRATION_CONWAY
      readonly params: { readonly stakeCredential: LedgerCredentialParams; readonly deposit: string }
    }
  | {
      readonly type: 9 // VOTE_DELEGATION
      readonly params: { readonly stakeCredential: LedgerCredentialParams; readonly dRep: LedgerDRepParams }
    }
  | {
      readonly type: 14 // AUTHORIZE_COMMITTEE_HOT
      readonly params: {
        readonly coldCredential: LedgerCredentialParams
        readonly hotCredential: LedgerCredentialParams
      }
    }
  | {
      readonly type: 15 // RESIGN_COMMITTEE_COLD
      readonly params: { readonly coldCredential: LedgerCredentialParams; readonly anchor?: LedgerAnchorParams | null }
    }
  | {
      readonly type: 16 // DREP_REGISTRATION
      readonly params: {
        readonly dRepCredential: LedgerCredentialParams
        readonly deposit: string
        readonly anchor?: LedgerAnchorParams | null
      }
    }
  | {
      readonly type: 17 // DREP_DEREGISTRATION
      readonly params: { readonly dRepCredential: LedgerCredentialParams; readonly deposit: string }
    }
  | {
      readonly type: 18 // DREP_UPDATE
      readonly params: { readonly dRepCredential: LedgerCredentialParams; readonly anchor?: LedgerAnchorParams | null }
    }

/**
 * Ledger withdrawal.
 * Matches SDK Withdrawal type with stakeCredential.
 */
export type LedgerWithdrawal = {
  /** Stake credential */
  readonly stakeCredential: LedgerCredentialParams
  /** Amount in lovelace */
  readonly amount: string
}

/**
 * Ledger voter type for Conway governance.
 * Numeric values matching SDK VoterType enum:
 * 0 = COMMITTEE_KEY_HASH, 100 = COMMITTEE_KEY_PATH, 1 = COMMITTEE_SCRIPT_HASH,
 * 2 = DREP_KEY_HASH, 102 = DREP_KEY_PATH, 3 = DREP_SCRIPT_HASH,
 * 4 = STAKE_POOL_KEY_HASH, 104 = STAKE_POOL_KEY_PATH.
 */
export type LedgerVoter =
  | { readonly type: 0; readonly keyHashHex: string } // COMMITTEE_KEY_HASH
  | { readonly type: 100; readonly keyPath: ReadonlyArray<number> } // COMMITTEE_KEY_PATH
  | { readonly type: 1; readonly scriptHashHex: string } // COMMITTEE_SCRIPT_HASH
  | { readonly type: 2; readonly keyHashHex: string } // DREP_KEY_HASH
  | { readonly type: 102; readonly keyPath: ReadonlyArray<number> } // DREP_KEY_PATH
  | { readonly type: 3; readonly scriptHashHex: string } // DREP_SCRIPT_HASH
  | { readonly type: 4; readonly keyHashHex: string } // STAKE_POOL_KEY_HASH
  | { readonly type: 104; readonly keyPath: ReadonlyArray<number> } // STAKE_POOL_KEY_PATH

/**
 * Ledger vote for a governance action.
 */
export type LedgerVote = {
  readonly govActionId: {
    readonly txHashHex: string
    readonly govActionIndex: number
  }
  readonly votingProcedure: {
    readonly vote: 0 | 1 | 2
    readonly anchor?: {
      readonly url: string
      readonly hashHex: string
    }
  }
}

/**
 * Ledger voter votes — a voter with their list of votes.
 */
export type LedgerVoterVotes = {
  readonly voter: LedgerVoter
  readonly votes: ReadonlyArray<LedgerVote>
}

/**
 * Ledger sign transaction request.
 * Signing mode must match @cardano-foundation/ledgerjs-hw-app-cardano TransactionSigningMode enum values.
 */
export type LedgerSignTxRequest = {
  /** Signing mode */
  readonly signingMode: "ordinary_transaction" | "plutus_transaction" | "multisig_transaction"
  /** Transaction body */
  readonly tx: {
    /** Network ID */
    readonly network: {
      readonly networkId: number
      readonly protocolMagic: number
    }
    /** Inputs */
    readonly inputs: ReadonlyArray<LedgerTxInput>
    /** Outputs */
    readonly outputs: ReadonlyArray<LedgerTxOutput>
    /** Fee in lovelace */
    readonly fee: string
    /** TTL slot */
    readonly ttl?: string
    /** Validity interval start */
    readonly validityIntervalStart?: string
    /** Certificates */
    readonly certificates?: ReadonlyArray<LedgerCertificate>
    /** Withdrawals */
    readonly withdrawals?: ReadonlyArray<LedgerWithdrawal>
    /** Auxiliary data (arbitrary hash or CIP-36 registration) */
    readonly auxiliaryData?: LedgerAuxiliaryData
    /** Mint */
    readonly mint?: ReadonlyArray<LedgerAssetGroup>
    /** Script data hash */
    readonly scriptDataHashHex?: string
    /** Collateral inputs */
    readonly collateralInputs?: ReadonlyArray<LedgerTxInput>
    /** Required signers (matches SDK RequiredSigner type) */
    readonly requiredSigners?: ReadonlyArray<LedgerRequiredSigner>
    /** Network ID in body */
    readonly includeNetworkId?: boolean
    /** Collateral return */
    readonly collateralOutput?: LedgerTxOutput
    /** Total collateral */
    readonly totalCollateral?: string
    /** Reference inputs */
    readonly referenceInputs?: ReadonlyArray<LedgerTxInput>
    /** Voting procedures (Conway governance) */
    readonly votingProcedures?: ReadonlyArray<LedgerVoterVotes>
    /** Current treasury value (Conway, body key 21) */
    readonly treasury?: string
    /** Treasury donation (Conway, body key 22) */
    readonly donation?: string
  }
  /** Additional witnesses */
  readonly additionalWitnessPaths?: ReadonlyArray<ReadonlyArray<number>>
  /** Signing options */
  readonly options?: {
    /** Whether the transaction uses CBOR tag 258 for sets (Conway-era) */
    readonly tagCborSets?: boolean
  }
}

/**
 * Ledger required signer.
 * Matches SDK RequiredSigner type with lowercase string enum values.
 */
export type LedgerRequiredSigner =
  | { readonly type: "required_signer_path"; readonly path: ReadonlyArray<number> }
  | { readonly type: "required_signer_hash"; readonly hashHex: string }

/**
 * Ledger CIP-36 vote delegation.
 * Matches SDK CIP36VoteDelegation type.
 */
export type LedgerCIP36VoteDelegation =
  | { readonly type: "cip36_vote_key_keyHex"; readonly voteKeyHex: string; readonly weight: number }
  | { readonly type: "cip36_vote_key_path"; readonly voteKeyPath: ReadonlyArray<number>; readonly weight: number }

/**
 * Ledger CIP-36 voter registration parameters.
 * Matches SDK CIP36VoteRegistrationParams type.
 */
export type LedgerCIP36RegistrationParams = {
  /** Registration format */
  readonly format: "cip_15" | "cip_36"
  /** Vote key hex (CIP-15 single key) */
  readonly voteKeyHex?: string
  /** Vote key path (CIP-15 single key) */
  readonly voteKeyPath?: ReadonlyArray<number>
  /** Vote key delegations (CIP-36 multi-delegation) */
  readonly delegations?: ReadonlyArray<LedgerCIP36VoteDelegation>
  /** Staking key path */
  readonly stakingPath: ReadonlyArray<number>
  /** Payment destination for registration rewards */
  readonly paymentDestination: LedgerTxOutputDestination
  /** Registration nonce */
  readonly nonce: string
  /** Voting purpose (0 = Catalyst) */
  readonly votingPurpose?: number
}

/**
 * Ledger auxiliary data — either an arbitrary hash or structured CIP-36 registration.
 * Matches SDK TxAuxiliaryData type with lowercase string enum values.
 */
export type LedgerAuxiliaryData =
  | { readonly type: "arbitrary_hash"; readonly params: { readonly hashHex: string } }
  | { readonly type: "cip36_registration"; readonly params: LedgerCIP36RegistrationParams }

/**
 * Ledger sign transaction response.
 */
