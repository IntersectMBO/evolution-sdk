import { FastCheck, Schema } from "effect"

/**
 * Plutus languages supported in cost models.
 *
 * CDDL: language = 0 / 1 / 2  ; plutus_v1 / plutus_v2 / plutus_v3
 *
 * @since 2.0.0
 */
export const Language = Schema.Literal("PlutusV1", "PlutusV2", "PlutusV3")
export type Language = typeof Language.Type

export const arbitrary: FastCheck.Arbitrary<Language> = FastCheck.oneof(
  FastCheck.constant("PlutusV1" as const),
  FastCheck.constant("PlutusV2" as const),
  FastCheck.constant("PlutusV3" as const)
)
