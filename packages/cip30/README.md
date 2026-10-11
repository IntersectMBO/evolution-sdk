# @evolution-sdk/cip30

The CIP-30 wallet read surface, returning the exact wire encodings, over a provider and an
account. Plus CIP-95 (governance keys), CIP-103, CIP-104 (account public key) and CIP-142
(network magic).

```ts
import { Account, Connector, Consent } from "@evolution-sdk/cip30"

const account = Account.fromRoot(rootXprv, 0)
const connector = Connector.make(account, provider, networkId)

await Effect.runPromise(connector.getUtxos())        // TransactionUnspentOutput hex
await Effect.runPromise(connector.getBalance())      // Value hex
await Effect.runPromise(connector.getChangeAddress())// RAW address bytes as hex, not bech32
```

## Scope: this is the READ surface

It deliberately does **not** carry `signTx` / `signTxs` / `signData`. A signing method reachable
straight off a connector is a footgun for anyone embedding it: this package owns byte-exactness,
not authorization. A wallet answers signing requests with a sentinel its host catches, then runs
its own review and key-custody ceremony.

The signing *encodings* live in `ReferenceSigning`, separate and clearly labelled as unsafe, so
they can be tested without being reachable by accident.

## Consent

`getAccountPublicKey` reveals every address a wallet has used and its whole history, and CIP-30
treats it as a transparent read, so nothing else in a wallet's flow would prompt for it. It is
consent-gated: the method *requires* `ConsentTag`, which makes it type-level impossible to serve
without the app's approval implementation.

```ts
connector.getAccountPublicKey().pipe(Effect.provide(Consent.consentFrom((req) => showDialog(req))))
```

`Consent.allowAll` exists for tests; `Consent.denyAll` is the safe default before a prompt is
wired.

Signing is *not* gated this way, deliberately: a boolean approval callback cannot express a
review ceremony, and pretending otherwise would be worse than not offering it.

## CIP-95 and what the provider must be able to say

`getRegisteredPubStakeKeys` / `getUnregisteredPubStakeKeys` need to know whether a stake key is
registered on chain, which is **not** derivable from the seed or from the delegation: a registered
account that has not delegated looks exactly like one that was never registered.

A dApp reads this split to decide whether a vote-delegation certificate needs a registration
certificate beside it, so answering it wrongly builds a transaction the node rejects. When the
provider cannot report `Delegation.registered`, these methods **fail** rather than return an empty
list, because an empty list is a factual claim.

## Tests

```sh
pnpm test
```
