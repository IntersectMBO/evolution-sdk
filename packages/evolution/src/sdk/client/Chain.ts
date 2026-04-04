/**
 * Cardano chain descriptors for client configuration.
 *
 * A `Chain` is a complete, self-describing network descriptor. It carries all
 * the information needed to configure addresses, slot arithmetic, and block
 * explorer URLs for a given Cardano network.
 *
 * Use the built-in constants for known networks, or `defineChain` for custom
 * devnets and private networks.
 *
 * @example
 * import { preprod, mainnet, preview, defineChain } from "@evolution-sdk/evolution"
 *
 * @since 2.1.0
 * @category model
 */
export interface Chain {
  /** Human-readable network name */
  readonly name: string
  /**
   * CBOR network encoding.
   * `1` = mainnet, `0` = all testnets.
   */
  readonly id: 0 | 1
  /**
   * Protocol magic number — uniquely identifies the network instance.
   * Mainnet: 764824073 | Preprod: 1 | Preview: 2 | Custom: any
   */
  readonly networkMagic: number
  /** Slot configuration for time ↔ slot conversion */
  readonly slotConfig: {
    /** Unix timestamp (milliseconds) of the Shelley era start */
    readonly zeroTime: bigint
    /** First slot number of the Shelley era */
    readonly zeroSlot: bigint
    /** Duration of each slot in milliseconds (typically 1000) */
    readonly slotLength: number
  }
  /** Number of slots per epoch */
  readonly epochLength: number
  /** Block explorer base URLs (optional — not available for custom chains) */
  readonly blockExplorers?: {
    readonly cardanoscan?: string
    readonly cexplorer?: string
  }
}

/**
 * Define a custom Cardano chain for devnets, private networks, or any network
 * not built into the SDK.
 *
 * @example
 * import { defineChain, client, kupmios } from "@evolution-sdk/evolution"
 *
 * const devnet = defineChain({
 *   name: "Local Devnet",
 *   id: 0,
 *   networkMagic: 42,
 *   slotConfig: { zeroTime: 1743379200000n, zeroSlot: 0n, slotLength: 1000 },
 *   epochLength: 500,
 * })
 *
 * const c = client(devnet).with(kupmios({ kupoUrl: "http://localhost:1442", ogmiosUrl: "ws://localhost:1337" }))
 *
 * @since 2.1.0
 * @category constructors
 */
export const defineChain = (chain: Chain): Chain => chain

/**
 * Cardano Mainnet.
 *
 * @since 2.1.0
 * @category chains
 */
export const mainnet: Chain = {
  name: "Cardano Mainnet",
  id: 1,
  networkMagic: 764824073,
  slotConfig: {
    zeroTime: 1596059091000n,
    zeroSlot: 4492800n,
    slotLength: 1000
  },
  epochLength: 432000,
  blockExplorers: {
    cardanoscan: "https://cardanoscan.io",
    cexplorer: "https://cexplorer.io"
  }
}

/**
 * Cardano Pre-Production Testnet (Preprod).
 *
 * @since 2.1.0
 * @category chains
 */
export const preprod: Chain = {
  name: "Cardano Preprod",
  id: 0,
  networkMagic: 1,
  slotConfig: {
    zeroTime: 1655769600000n,
    zeroSlot: 86400n,
    slotLength: 1000
  },
  epochLength: 432000,
  blockExplorers: {
    cardanoscan: "https://preprod.cardanoscan.io",
    cexplorer: "https://preprod.cexplorer.io"
  }
}

/**
 * Cardano Preview Testnet.
 *
 * @since 2.1.0
 * @category chains
 */
export const preview: Chain = {
  name: "Cardano Preview",
  id: 0,
  networkMagic: 2,
  slotConfig: {
    zeroTime: 1666656000000n,
    zeroSlot: 0n,
    slotLength: 1000
  },
  epochLength: 86400,
  blockExplorers: {
    cardanoscan: "https://preview.cardanoscan.io",
    cexplorer: "https://preview.cexplorer.io"
  }
}
