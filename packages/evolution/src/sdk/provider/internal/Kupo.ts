import { Schema as S } from "effect"

export const ValueSchema = S.Struct({
  coins: S.BigInt,
  assets: S.Record({ key: S.String, value: S.BigInt })
})
export interface Value extends S.Schema.Type<typeof ValueSchema> {}

export const UTxOSchema = S.Struct({
  transaction_index: S.BigInt,
  transaction_id: S.String,
  output_index: S.BigInt,
  address: S.String,
  value: ValueSchema,
  datum_hash: S.NullOr(S.String),
  datum_type: S.optional(S.Literal("hash", "inline")),
  script_hash: S.NullOr(S.String),
  created_at: S.Struct({
    slot_no: S.BigInt,
    header_hash: S.String
  }),
  spent_at: S.NullOr(
    S.Struct({
      slot_no: S.BigInt,
      header_hash: S.String
    })
  )
})

export interface UTxO extends S.Schema.Type<typeof UTxOSchema> {}

export const ScriptSchema = S.NullOr(
  S.Struct({
    language: S.Literal("native", "plutus:v1", "plutus:v2", "plutus:v3"),
    script: S.String
  })
)
export type Script = S.Schema.Type<typeof ScriptSchema>

export const DatumSchema = S.NullOr(S.Struct({ datum: S.String }))

export type Datum = S.Schema.Type<typeof DatumSchema>

export const DelegationSchema = S.NullOr(
  S.Record({
    key: S.String,
    value: S.Struct({
      delegate: S.Struct({ id: S.String }),
      rewards: S.Struct({ ada: S.Struct({ lovelace: S.BigInt }) }),
      deposit: S.Struct({ ada: S.Struct({ lovelace: S.BigInt }) })
    })
  })
)
