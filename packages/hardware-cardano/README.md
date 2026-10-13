# @evolution-sdk/hardware-cardano

Build a Ledger or Trezor Cardano sign request from a reviewed transaction body.

Takes `@evolution-sdk/review`'s `Inspect.TxBodyView` and produces the parameter shape each
device expects. No vendor SDK, no transport, no WebUSB/HID environment: the request is data, and
this package only builds it.

## Why unrepresentable means "throw"

**The device recomputes the body hash from the request it is given.** A converter that silently
dropped a field it could not represent would obtain a signature over a different transaction than
the one the user approved. So anything unrepresentable is refused, by name:

- a body-map key the review tier cannot name (`unknownKeys`) — on both devices
- proposal procedures — on both devices
- voting procedures, treasury and donation fields, Byron outputs, and governance certificates
  beyond vote delegation — on Trezor
- pool, combined staking+governance, and deprecated certificates — on Ledger

Whether the input set arrived `#6.258` or bare travels into the request for the same reason: it
changes the bytes the device re-emits, and therefore the hash.

```ts
import { Inspect } from "@evolution-sdk/review"
import { Ledger } from "@evolution-sdk/hardware-cardano"
import { Effect } from "effect"

const { body, taggedSets } = Effect.runSync(Inspect.txBody(bodyHex))
const request = Ledger.buildLedgerSignRequest(body, networkId, signingPaths, "ordinary_transaction", {
  tagCborSets: taggedSets,
  publicKeys // lets the converter tell the user's own credentials from a third party's
})
```

## Own credentials, and signing mode

Given `publicKeys` (path → public key hex), both converters resolve which credentials are the
user's own. Outputs paying the user are marked device-owned so the device displays them as change
rather than as a payment to a stranger — a claim that **fails closed**, since the device
recomputes the address and the body hash would differ if it were wrong.

The same resolution picks the signing mode: a device's ordinary mode accepts only key-path
credentials in certificates, withdrawals and votes, so a script or a provably foreign key
escalates to Plutus mode. A multisig spend is **stated** by the caller, never inferred: a
CIP-1854 spend carries one signing path and names its keys in the script rather than in the body,
so nothing in the transaction distinguishes it from an ordinary one.

## Trezor's protocol constants

Declared here rather than imported, so building a request pulls in neither `@trezor/connect` nor
protobufjs. They are a copy of someone else's wire protocol, so they are checked against
`@trezor/protobuf` on every gate run — values and membership, both directions.
