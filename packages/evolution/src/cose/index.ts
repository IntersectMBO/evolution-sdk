/**
 * COSE (RFC 8152) message signing for Cardano.
 *
 * Implements CIP-30 wallet API and CIP-8 message signing using COSE_Sign1 structures.
 * Compatible with all major Cardano wallets.
 *
 * @since 2.0.0
 * @category namespace
 */

export * as Header from "./Header.js"
export * as COSEKey from "./Key.js"
export * as Label from "./Label.js"
export * as COSESign from "./Sign.js"
export * as COSESign1 from "./Sign1.js"
export * as SignData from "./SignData.js"
export * as Utils from "./Utils.js"
