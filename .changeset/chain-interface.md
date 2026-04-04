---
"@evolution-sdk/evolution": minor
"@evolution-sdk/devnet": minor
---

Introduce composable client API and typed wallet system.

## New composable client API

Clients are now built by composing a chain context with provider and wallet constructors via `.with()`. TypeScript infers the accumulated capabilities automatically:

```ts
import { client, preview, kupmios, seedWallet } from "@evolution-sdk/evolution"

const myClient = client(preview)
  .with(kupmios({ kupoUrl: "...", ogmiosUrl: "..." }))
  .with(seedWallet({ mnemonic: "..." }))

// Promise API
const utxos = await myClient.getUtxos(addr)
const signed = await myClient.signTx(tx)

// Effect API
myClient.Effect.getUtxos(addr).pipe(Effect.flatMap(...))

// Transaction building
myClient.newTx().payToAddress({ address: "addr1...", assets: { lovelace: 5_000_000n } })
```

Per-provider constructors: `blockfrost()`, `kupmios()`, `maestro()`, `koios()`

Per-wallet constructors: `seedWallet()`, `privateKeyWallet()`, `readOnlyWallet()`, `cip30Wallet()`

## New typed wallet factories

```ts
import { makeSigningWalletEffect, makePrivateKeyWalletEffect, makeReadOnlyWalletEffect } from "@evolution-sdk/evolution"

const wallet = Wallet.makeSigningWalletEffect(chain.id, mnemonic)
const address = yield* wallet.address()
const signed = yield* wallet.signTx(tx)
```

## Chain descriptor (breaking change)

`createClient` now requires an explicit `chain` field instead of the optional `network?: string` field:

```ts
// Before
createClient({
  network: "preprod",
  slotConfig: { zeroTime: 1655769600000n, zeroSlot: 86400n, slotLength: 1000 },
  provider: { ... },
  wallet: { ... }
})

// After
import { createClient, preprod } from "@evolution-sdk/evolution"

createClient({
  chain: preprod,
  provider: { ... },
  wallet: { ... }
})
```

Built-in chain constants: `mainnet`, `preprod`, `preview`. Use `defineChain` for custom networks:

```ts
const devnet = defineChain({
  name: "Devnet",
  id: 0,
  networkMagic: 42,
  slotConfig: { zeroTime: 0n, zeroSlot: 0n, slotLength: 1000 },
  epochLength: 432000,
})
```

## Devnet helpers

`@evolution-sdk/devnet` adds `getChain(cluster)` and `BOOTSTRAP_CHAIN` for constructing a `Chain` from a running local cluster.

## Other breaking changes

- `Koios` class renamed to `KoiosProvider` for consistency with `BlockfrostProvider`, `MaestroProvider`, `KupmiosProvider`
- `networkId` property on client objects replaced with `chain: Chain`
- `createClient` is deprecated in favour of the composable `client()` API
