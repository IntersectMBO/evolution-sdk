import { CHAINS, parseNetwork } from "./network.ts"

export const network = parseNetwork(import.meta.env.VITE_NETWORK)
export const chain = CHAINS[network]
export const isMainnet = network === "mainnet"
