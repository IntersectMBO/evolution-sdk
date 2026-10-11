/**
 * The failure this package puts in the typed channel.
 *
 * @since 0.1.0
 */

import { Data } from "effect"

/**
 * Malformed CBOR or hex on a decode path.
 *
 * @since 0.1.0
 */
export class CborError extends Data.TaggedError("CborError")<{ readonly message: string }> {}
