// @title: Working with Maps
// @description: Create and manipulate Data Maps with key-value pairs.
// #region main
import assert from "node:assert/strict"
import { Bytes, Data } from "@evolution-sdk/evolution"

// Create byte keys to use consistently
const aliceKey = Bytes.fromHexUnsafe("616c696365") // 'alice' in hex
const bobKey = Bytes.fromHexUnsafe("626f62") // 'bob' in hex
const charlieKey = Bytes.fromHexUnsafe("636861726c6965") // 'charlie' in hex

// Create a simple map with byte keys and integer values
const userAges = new Map<Data.Data, Data.Data>([
  [aliceKey, 25n],
  [bobKey, 30n],
  [charlieKey, 35n]
])

console.log("User ages map:", userAges)

// Create constructor keys to use consistently
const pendingKey = new Data.Constr({ index: 0n, fields: [] })
const approvedKey = new Data.Constr({ index: 1n, fields: [] })
const rejectedKey = new Data.Constr({ index: 2n, fields: [] })

// Create a map with constructor keys and byte values
const statusMap = new Map<Data.Data, Data.Data>([
  [pendingKey, Bytes.fromHexUnsafe("70656e64696e67")], // 'pending' in hex
  [approvedKey, Bytes.fromHexUnsafe("617070726f766564")], // 'approved' in hex
  [rejectedKey, Bytes.fromHexUnsafe("72656a6563746564")] // 'rejected' in hex
])

// Demonstrate map usage - use the same key reference for lookups
console.log("Alice's age:", userAges.get(aliceKey))
console.log("Status for pending:", statusMap.get(pendingKey))

// Create a constructor that contains Data values
const dataRecord = new Data.Constr({
  index: 1n,
  fields: [
    25n, // alice's age directly
    Bytes.fromHexUnsafe("deadbeef"), // some data
    42n // more data
  ]
})

// Verify map operations - use same key references
assert.deepEqual(userAges.get(aliceKey), 25n) // alice's age
assert.equal(userAges.size, 3)
assert.equal(dataRecord.fields.length, 3)
// #endregion main
