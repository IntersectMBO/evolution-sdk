---
"@evolution-sdk/evolution": patch
"@evolution-sdk/devnet": patch
---

`createClient` now requires an explicit `chain` field instead of the optional `network?: string` field.

Previously, selecting a network required passing a string identifier and, separately, a `slotConfig` object for slot/time conversions. There was no single source of truth that tied network identity, magic number, and timing parameters together:

```ts
// Before
createClient({
  network: "preprod",
  slotConfig: { zeroTime: 1655769600000n, zeroSlot: 86400n, slotLength: 1000 },
  provider: { ... },
  wallet: { ... }
})
```

Now the `chain` field is a rich descriptor that carries all of this together. Three built-in constants are exported from the top-level package:

```ts
// After
import { createClient, preprod } from "@evolution-sdk/evolution"

createClient({
  chain: preprod,
  provider: { ... },
  wallet: { ... }
})
```

For custom networks — local devnets, private chains, or future forks — use `defineChain`:

```ts
import { defineChain } from "@evolution-sdk/evolution"

const devnet = defineChain({
  name: "Devnet",
  id: 0,
  networkMagic: 42,
  slotConfig: { zeroTime: 0n, zeroSlot: 0n, slotLength: 1000 },
  epochLength: 432000,
})
```

The `networkId: number | string` property on client objects is replaced with `chain: Chain`. The `@evolution-sdk/devnet` package adds `getChain(cluster)` and `BOOTSTRAP_CHAIN` for constructing a `Chain` from a running local devnet.
