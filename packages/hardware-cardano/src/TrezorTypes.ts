/**
 * Trezor's Cardano sign-request parameter shapes, and the protocol constants they use.
 *
 * Declared here rather than imported from `@trezor/connect` and `@trezor/protobuf` so this
 * package builds a request without pulling in the vendor SDK, its transport, or protobufjs. The
 * numeric values are Trezor's wire protocol and are fixed by firmware.
 *
 * @since 0.1.0
 */

/**
 * Trezor's `CardanoAddressType`.
 *
 * @since 0.1.0
 */
export const CardanoAddressType = {
  BASE: 0,
  BASE_SCRIPT_KEY: 1,
  BASE_KEY_SCRIPT: 2,
  BASE_SCRIPT_SCRIPT: 3,
  POINTER: 4,
  POINTER_SCRIPT: 5,
  ENTERPRISE: 6,
  ENTERPRISE_SCRIPT: 7,
  BYRON: 8,
  REWARD: 14,
  REWARD_SCRIPT: 15
} as const

/**
 * Trezor's `CardanoCertificateType`.
 *
 * @since 0.1.0
 */
export const CardanoCertificateType = {
  STAKE_REGISTRATION: 0,
  STAKE_DEREGISTRATION: 1,
  STAKE_DELEGATION: 2,
  STAKE_POOL_REGISTRATION: 3,
  STAKE_REGISTRATION_CONWAY: 7,
  STAKE_DEREGISTRATION_CONWAY: 8,
  VOTE_DELEGATION: 9
} as const

/**
 * Trezor's `CardanoDerivationType`. `ICARUS_TREZOR` is the default for Cardano.
 *
 * @since 0.1.0
 */
export const CardanoDerivationType = {
  LEDGER: 0,
  ICARUS: 1,
  ICARUS_TREZOR: 2
} as const

/**
 * Trezor's `CardanoDRepType`.
 *
 * @since 0.1.0
 */
export const CardanoDRepType = {
  KEY_HASH: 0,
  SCRIPT_HASH: 1,
  ABSTAIN: 2,
  NO_CONFIDENCE: 3
} as const

/**
 * Trezor's `CardanoTxSigningMode`.
 *
 * @since 0.1.0
 */
export const CardanoTxSigningMode = {
  ORDINARY_TRANSACTION: 0,
  POOL_REGISTRATION_AS_OWNER: 1,
  MULTISIG_TRANSACTION: 2,
  PLUTUS_TRANSACTION: 3
} as const

/**
 * CIP-36 (Catalyst) vote-registration parameters.
 *
 * @since 0.1.0
 */
export type CIP36RegistrationParams = {
  /** Vote key delegations: several weighted keys, or a single key. */
  readonly delegations:
    ReadonlyArray<{ readonly voteKeyHex: string; readonly weight: number }> | { readonly voteKeyHex: string }
  /** Staking key derivation path. */
  readonly stakingPath: string
  /** Where rewards are paid. */
  readonly paymentDestination:
    | { readonly type: "third_party"; readonly addressHex: string }
    | {
        readonly type: "device_owned"
        readonly addressParams: { readonly spendingPath: string; readonly stakingPath: string }
      }
  /** Registration nonce (slot number). */
  readonly nonce: string
  /** Voting purpose (0 = Catalyst). */
  readonly votingPurpose?: number
}

/**
 * Trezor Cardano address parameters.
 */
export type TrezorCardanoAddressParams = {
  /** Address type */
  readonly addressType: TrezorCardanoAddressType
  /** Network ID */
  readonly networkId: number
  /** Protocol magic */
  readonly protocolMagic: number
  /** Spending key path as string */
  readonly spendingPath: string
  /** Staking key path as string */
  readonly stakingPath?: string
  /** Staking key hash */
  readonly stakingKeyHash?: string
  /** Staking script hash */
  readonly stakingScriptHash?: string
}

/**
 * Trezor Cardano address types.
 */
export type TrezorCardanoAddressType =
  | 0 // BASE
  | 1 // BASE_SCRIPT_KEY
  | 2 // BASE_KEY_SCRIPT
  | 3 // BASE_SCRIPT_SCRIPT
  | 4 // POINTER
  | 5 // POINTER_SCRIPT
  | 6 // ENTERPRISE
  | 7 // ENTERPRISE_SCRIPT
  | 8 // BYRON
  | 14 // REWARD
  | 15 // REWARD_SCRIPT

/**
 * Trezor Cardano get address request.
 */
export type TrezorCardanoGetAddressRequest = {
  /** Address parameters */
  readonly addressParameters: TrezorCardanoAddressParams
  /** Show on device display */
  readonly showOnTrezor?: boolean
  /** Derivation type */
  readonly derivationType?: number
}

/**
 * Trezor Cardano get address response.
 */
export type TrezorCardanoGetAddressResponse = {
  /** Address (bech32 or base58) */
  readonly address: string
  /** Protocol magic used */
  readonly protocolMagic: number
  /** Network ID used */
  readonly networkId: number
  /** Serialized path */
  readonly serializedPath?: string
  /** Serialized staking path */
  readonly serializedStakingPath?: string
}

/**
 * Trezor Cardano get public key request.
 */
export type TrezorCardanoGetPublicKeyRequest = {
  /** Derivation path as string */
  readonly path: string
  /** Show on device display */
  readonly showOnTrezor?: boolean
  /** Derivation type */
  readonly derivationType?: number
}

/**
 * Trezor Cardano get public key response.
 */
export type TrezorCardanoGetPublicKeyResponse = {
  /** Public key hex */
  readonly publicKey: string
  /** Node containing xpub */
  readonly node: {
    readonly public_key: string
    readonly chain_code: string
    readonly depth: number
    readonly child_num: number
    readonly fingerprint: number
  }
}

/**
 * Trezor Cardano transaction input.
 */
export type TrezorCardanoInput = {
  /** Previous transaction hash */
  readonly prev_hash: string
  /** Previous output index */
  readonly prev_index: number
  /** Path if owned */
  readonly path?: string
}

/**
 * Trezor Cardano transaction output.
 */
export type TrezorCardanoOutput = {
  /** Address (if external) */
  readonly address?: string
  /** Address parameters (if internal) */
  readonly addressParameters?: TrezorCardanoAddressParams
  /** Amount in lovelace */
  readonly amount: string
  /** Token bundle */
  readonly tokenBundle?: ReadonlyArray<TrezorCardanoAssetGroup>
  /** Datum hash */
  readonly datumHash?: string
  /** Inline datum */
  readonly inlineDatum?: string
  /** Reference script */
  readonly referenceScript?: string
  /** Output format */
  readonly format?: number
}

/**
 * Trezor Cardano asset group.
 */
export type TrezorCardanoAssetGroup = {
  /** Policy ID */
  readonly policyId: string
  /** Tokens */
  readonly tokenAmounts: ReadonlyArray<TrezorCardanoToken>
}

/**
 * Trezor Cardano token.
 */
export type TrezorCardanoToken = {
  /** Asset name hex */
  readonly assetNameBytes: string
  /** Amount (for output tokens) */
  readonly amount?: string
  /** Mint amount (for minting/burning — sint64, can be negative) */
  readonly mintAmount?: string
}

/**
 * Trezor Cardano certificate.
 * Matches Trezor Connect CardanoCertificate type.
 */
export type TrezorCardanoCertificate = {
  /** Certificate type */
  readonly type: TrezorCardanoCertificateType
  /** Stake key path */
  readonly path?: string
  /** Stake key hash */
  readonly keyHash?: string
  /** Script hash */
  readonly scriptHash?: string
  /** Pool ID */
  readonly pool?: string
  /** Deposit amount (Conway-era certs) */
  readonly deposit?: string
  /** DRep (for VOTE_DELEGATION) */
  readonly dRep?: TrezorCardanoDRep
}

/**
 * Trezor Cardano DRep params (for VOTE_DELEGATION certificates).
 * Matches Trezor Connect CardanoDRep type.
 */
export type TrezorCardanoDRep = {
  /** DRep type: 0=KEY_HASH, 1=SCRIPT_HASH, 2=ABSTAIN, 3=NO_CONFIDENCE */
  readonly type: TrezorCardanoDRepType
  /** Key hash (for KEY_HASH type) */
  readonly keyHash?: string
  /** Script hash (for SCRIPT_HASH type) */
  readonly scriptHash?: string
}

/**
 * Trezor Cardano DRep types.
 */
export type TrezorCardanoDRepType =
  | 0 // KEY_HASH
  | 1 // SCRIPT_HASH
  | 2 // ABSTAIN
  | 3 // NO_CONFIDENCE

/**
 * Trezor Cardano certificate types.
 * Matches CardanoCertificateType from @trezor/protobuf.
 */
export type TrezorCardanoCertificateType =
  | 0 // STAKE_REGISTRATION
  | 1 // STAKE_DEREGISTRATION
  | 2 // STAKE_DELEGATION
  | 3 // STAKE_POOL_REGISTRATION
  | 7 // STAKE_REGISTRATION_CONWAY
  | 8 // STAKE_DEREGISTRATION_CONWAY
  | 9 // VOTE_DELEGATION

/**
 * Trezor Cardano withdrawal.
 */
export type TrezorCardanoWithdrawal = {
  /** Stake key path */
  readonly path?: string
  /** Stake key hash */
  readonly keyHash?: string
  /** Script hash */
  readonly scriptHash?: string
  /** Amount in lovelace */
  readonly amount: string
}

/**
 * Trezor Cardano voter type.
 * Maps to the voter types used in Conway-era governance.
 */
export type TrezorCardanoVoterType =
  | 0 // COMMITTEE_KEY_HASH
  | 1 // COMMITTEE_SCRIPT_HASH
  | 2 // DREP_KEY_HASH
  | 3 // DREP_SCRIPT_HASH
  | 4 // STAKE_POOL_KEY_HASH

/**
 * Trezor Cardano voter.
 */
export type TrezorCardanoVoter = {
  /** Voter type */
  readonly type: TrezorCardanoVoterType
  /** Key hash (for key-based voters) */
  readonly keyHash?: string
  /** Script hash (for script-based voters) */
  readonly scriptHash?: string
}

/**
 * Trezor Cardano voting procedure.
 */
export type TrezorCardanoVotingProcedure = {
  /** Voter */
  readonly voter: TrezorCardanoVoter
  /** Governance action ID */
  readonly govActionId: {
    readonly txHash: string
    readonly index: number
  }
  /** Voting procedure */
  readonly votingProcedure: {
    readonly vote: number
    readonly anchor?: {
      readonly url: string
      readonly hash: string
    }
  }
}

/**
 * Trezor Cardano sign transaction request.
 */
export type TrezorCardanoSignTxRequest = {
  /** Signing mode */
  readonly signingMode: number
  /** Protocol magic */
  readonly protocolMagic: number
  /** Network ID */
  readonly networkId: number
  /** Inputs */
  readonly inputs: ReadonlyArray<TrezorCardanoInput>
  /** Outputs */
  readonly outputs: ReadonlyArray<TrezorCardanoOutput>
  /** Fee */
  readonly fee: string
  /** TTL */
  readonly ttl?: string
  /** Validity interval start */
  readonly validityIntervalStart?: string
  /** Certificates */
  readonly certificates?: ReadonlyArray<TrezorCardanoCertificate>
  /** Withdrawals */
  readonly withdrawals?: ReadonlyArray<TrezorCardanoWithdrawal>
  /** Auxiliary data hash */
  readonly auxiliaryDataHash?: string
  /** Mint */
  readonly mint?: ReadonlyArray<TrezorCardanoAssetGroup>
  /** Script data hash */
  readonly scriptDataHash?: string
  /** Collateral inputs */
  readonly collateralInputs?: ReadonlyArray<TrezorCardanoInput>
  /** Required signers */
  readonly requiredSigners?: ReadonlyArray<{
    readonly keyPath?: string
    readonly keyHash?: string
  }>
  /** Network ID in body */
  readonly includeNetworkId?: boolean
  /** Collateral return */
  readonly collateralReturn?: TrezorCardanoOutput
  /** Total collateral */
  readonly totalCollateral?: string
  /** Reference inputs */
  readonly referenceInputs?: ReadonlyArray<TrezorCardanoInput>
  /** Voting procedures (Conway governance) */
  readonly votingProcedures?: ReadonlyArray<TrezorCardanoVotingProcedure>
  /** Additional witness paths */
  readonly additionalWitnessRequests?: ReadonlyArray<string>
  /** Derivation type */
  readonly derivationType?: number
  /** Tag CBOR sets with tag 258 (Conway-era CIP-0057) */
  readonly tagCborSets?: boolean
  /** CIP-36 registration parameters */
  readonly auxiliaryData?: {
    readonly cip36RegistrationParameters?: {
      readonly votingPublicKey: string
      readonly stakingPath: string
      readonly nonce: string
      readonly format: number
      readonly paymentAddressParameters: TrezorCardanoAddressParams
      readonly delegations?: ReadonlyArray<{
        readonly votingPublicKey: string
        readonly weight: number
      }>
    }
  }
}
