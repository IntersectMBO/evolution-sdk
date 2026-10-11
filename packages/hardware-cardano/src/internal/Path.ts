/**
 * BIP-32 derivation paths in their STRING form.
 *
 * A device API speaks paths as `m/1852'/1815'/0'/0/0`; `Bip32PrivateKey.CardanoPath` builds the
 * index arrays. This is the parser between them.
 *
 * @since 0.1.0
 */

/** @since 0.1.0 */
export const HARDENED = 0x80000000

/**
 * Parse `m/1852'/1815'/0'/0/0` into its index array, hardening applied.
 *
 * ⚠️ Throws on a component that is not a number. A device is handed this array verbatim, and a
 * `NaN` component is a path nobody can derive — failing here names the bad input instead.
 *
 * @since 0.1.0
 */
export const parseDerivationPath = (path: string): ReadonlyArray<number> => {
  const body = path.replace(/^m\//, "")
  if (body === "") throw new Error(`derivation path: "${path}" names no indices`)
  return body.split("/").map((component) => {
    const hardened = component.endsWith("'") || component.endsWith("h")
    const digits = hardened ? component.slice(0, -1) : component
    if (!/^\d+$/.test(digits)) throw new Error(`derivation path: "${component}" is not an index in "${path}"`)
    const index = Number.parseInt(digits, 10)
    // At or above 2^31 a component collides with the hardening bit, so an index written
    // unhardened would quietly become its hardened twin -- a different key.
    if (!Number.isSafeInteger(index) || index >= HARDENED) {
      throw new Error(`derivation path: index ${digits} is out of range in "${path}"`)
    }
    return hardened ? index + HARDENED : index
  })
}

/**
 * Format an index array back to its string form.
 *
 * @since 0.1.0
 */
export const formatDerivationPath = (path: ReadonlyArray<number>): string =>
  `m/${path.map((component) => (component >= HARDENED ? `${component - HARDENED}'` : String(component))).join("/")}`
