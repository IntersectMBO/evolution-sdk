# @evolution-sdk/plan

Wallet-side transaction planning: a plan describes what a transaction should do, and this engine
converges the fee, the change and the collateral until the plan balances.

Two modules:

- **`Plan`** — the engine. `buildUnsigned` takes a `CardanoPlan` and returns the body bytes, the
  inputs it chose, the change it emitted and a `FeeBreakdown`.
- **`ExUnits`** — where a redeemer's execution units come from: supplied by the caller, taken from
  a preset table, or evaluated by a provider, with a margin applied.

It reaches no network and holds no key. It does encode: `internal/Encode.ts` calls
`@evolution-sdk/evolution` directly, so there is one encoder rather than a seam that can drift
from it.

## Planning

```ts
import { Plan } from "@evolution-sdk/plan"

const built = Plan.buildUnsigned({
  inputs,                           // ReadonlyArray<PlanInput>, hex-shaped
  outputs,                          // ReadonlyArray<PlanOutput>
  changeAddressHex,
  params,                           // ProtocolParams
  signerCount: 2                    // what the fee must cover witnesses for
})
```

A plan is assembled by **plugins** — `sendPlugin`, `mintPlugin`, `certificatesPlugin`,
`withdrawalsPlugin`, `signersPlugin`, `auxPlugin`, `rawPlugin` — each contributing its part of the
body. `build` takes the list, so a caller needing a body part this engine does not model can add
one without forking the engine.

The fee is converged rather than estimated: the size of a transaction depends on the fee written
into it, so the engine re-encodes until the fee is stable. `signerCount` feeds that loop, and an
under-count is what produces `FeeTooSmallUTxO` at submission.

## Fees

The Conway fee components live in `@evolution-sdk/evolution` as `Fees`, in one implementation —
`Fees.scriptExecutionFee` and `Fees.refScriptFee`, both over exact rationals, with
`NonnegativeInterval.fromDecimal` to read a protocol parameter's decimal without a floating-point
step. This engine calls them; it no longer carries its own copy.

## Coin selection

CIP-2 selection lives in `@evolution-sdk/evolution` as `CoinSelection`. It was ported here first
and folded upstream, where the interface already declared `randomImproveSelection` and
`optimalSelection` with no implementation behind them.

## Tests

```sh
pnpm test
```
