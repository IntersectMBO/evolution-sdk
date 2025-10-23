// @title: Validate bytes
// @description: Quick check for Uint8Array bytes using Data.isBytes.
// #region main
import assert from "node:assert/strict"
import { Bytes, Data } from "@evolution-sdk/evolution"

const bytes = Bytes.fromHexUnsafe("deadbeef")
assert.equal(Data.isBytes(bytes), true)

const invalid = "not-bytes"
assert.equal(Data.isBytes(invalid), false)
// #endregion main
