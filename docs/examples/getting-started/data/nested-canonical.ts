// @title: Canonical nested structure
// @description: Complex nested Data encoding with canonical CBOR options.
// #region main
import assert from "node:assert/strict"
import { Bytes, CBOR, Data } from "@evolution-sdk/evolution"

const nestedUnsortedData = new Data.Constr({
  index: 1n,
  fields: [
    new Data.Constr({
      index: 0n,
      fields: [new Data.Constr({ index: 2n, fields: [] })]
    }),
    new Map<Data.Data, Data.Data>([
      [Bytes.fromHexUnsafe("deadbeef01"), new Data.Constr({ index: 0n, fields: [] })],
      [Bytes.fromHexUnsafe("beef"), 19n],
      [Bytes.fromHexUnsafe("deadbeef03"), new Data.Constr({ index: 1n, fields: [] })]
    ]),
    [10n, 5n, 2n, 3n, 1n, 4n]
  ]
})

const cborHex = Data.toCBORHex(nestedUnsortedData)
const decoded = Data.fromCBORHex(cborHex)
const canonicalCborHex = Data.toCBORHex(nestedUnsortedData, CBOR.CANONICAL_OPTIONS)

assert.deepStrictEqual(decoded, nestedUnsortedData)
// #endregion main
