# @evolution-sdk/cip113

CIP-113 programmable tokens: the consumer transfer path, the registry codecs, the deployment
records and the issuer derivation.

## The consumer path

`Cip113` is what a holder needs: the registry and params codecs, the withdraw-zero redeemers, the
smart-wallet address, and `buildTransferTx`, which assembles the unsigned transfer.

```ts
import { Cip113, Deployment, Query } from "@evolution-sdk/cip113"
```

## Why everything is parameterised

`Versions` carries a descriptor per on-chain shape, and every codec reads one instead of branching
on a version id. ⚠️ That is not future-proofing: the shapes moved **four times inside one audit
window**, and a codec that branches on an id has to be edited for each move while a codec that
reads a descriptor does not.

`Deployment` says WHERE an instance lives. Script hashes are deploy-time data, never constants —
an instance deployed from a different compilation has different hashes, and a constant would send
a transfer to a script that does not exist.

## The rest

- `Query` fetches the chain state a transfer needs.
- `Budgets` carries the measured ex-units for the framework scripts.
- `Classify` answers what a UTxO is.
- `Issuer` is the deploy-time derivation, and is **CLI/desktop only**: it takes an injected UPLC
  backend, so importing the rest of the package never pulls one into a bundle.

## Tests

```sh
pnpm test
```

The byte-level gates, and what each is evidence of:

| file | what it holds |
|---|---|
| `test/Cip113Codec.test.ts` | every redeemer and datum as a hex literal re-derivable from the Plutus CDDL, plus CML parsing our bytes and agreeing on the content. The decoders are fed CML-BUILT datums, never our own encoder's. |
| `test/Cip113Order.test.ts` | the orderings an index in a redeemer depends on — Plutus bytestring comparison (shorter is smaller on a prefix tie), and the ledger's script-before-key withdrawal order, which INVERTS the order the withdrawals map is serialised in. |
| `test/TransferTx.test.ts` | `buildTransferTx` through an assembled transaction, reparsed by CML: every `params_idx`, `node_idx`, `wdrl_idx` and redeemer index is resolved against the finished transaction. ⚠️ A corpus covering each encoder does not cover the pair, which is how a phase-2 redeemer bug hid. |
| `test/IssuerDerive.test.ts` | the deployment derivation against a RECORDING backend: which parameter reaches which validator, in which order, per generation. A wrong parameter yields a real, wrong hash, so the call log is the assertion. Also the issuance template's splice identity, which is what a registration proves on chain. |
| `test/IssuerTx.test.ts` | the bootstrap, issuance-cbor-hex, registration and issuance transactions, assembled and reparsed: lock targets per generation, the genesis authority withdrawal, the linked-list relink, and the two issuance indices that mean different things on either side of the split. |
| `test/Versions.test.ts` | the descriptors as DATA: every layout's declared positions must tile its field count exactly (a hole reaches the encoder as `undefined`, a duplicate loses a field), and the flags describing one fact must agree. Generic over every descriptor, so the next hand-written one is checked too. |
| `test/Classify.test.ts` | one case per row of `classifyPolicy`'s decision table, above all the rows where the honest answer is `unknown` rather than a reassuring `disabled`. |
| `test/Budgets.test.ts` | the budget ARITHMETIC, including the two mistakes it has already made: inputs and outputs were one axis until 2026-08-16, and `measurement` used to default to LATEST's — which under-budgets an alpha.2 deployment by more than the margin covers. |
| `test/UplcBackend.test.ts` | the Evolution-backed issuer backend: its hashes against CML AND against the earlier Rust attachment's own figure, and the splice identity through the REAL UPLC encoder. |
| `test/tx-shape.ts` | the shared CML reparse (not a suite). Body + witness set are reassembled into a whole Conway transaction, so a witness set the ledger could not read beside its body fails here. |

## The measurement

The recorded ex-units in `Budgets.ts` are the one thing no unit test can hold: they are
measurements of real validators, and the arithmetic over them being right says nothing about
whether they are still true. `harness/budgets.ts` is the re-derivation.

```sh
pnpm --filter @evolution-sdk/cip113 run budgets
CIP113_VERSION=v0.5.0-alpha.2 pnpm --filter @evolution-sdk/cip113 run budgets
```

It derives a deployment from upstream's own blueprint, builds transfers at seven shapes, prices
them on a local Plutus VM (`@evolution-sdk/aiken-uplc`), fits the budget model, and **fails if the
recorded presets no longer reproduce it** — so an upstream cost change surfaces here instead of as
a rejected transaction. All three recorded measurements reproduce to the digit as of 2026-10-11.

It needs a clone of `cardano-foundation/cip113-programmable-tokens` beside this repo (the
blueprint is upstream's build output and is not vendored); without one it **skips loudly** rather
than passing. `CIP113_CLONE`, `CIP113_BLUEPRINT` and `CIP113_BLUEPRINT_REF` override where the
blueprint comes from; the default is a pinned upstream ref per descriptor, read with `git show` so
no checkout is involved — a harness pointed at a working tree measures whatever branch it is on.

⚠️ What is still missing is a LIVE measurement: these are derived from upstream's blueprint, so
the validator bytes and therefore the slopes are real while the intercept carries the fabricated
transaction's shape. The margin in `transferBudgets` is for that, and it is not a substitute for
measuring the chain you submit to.

`src/UplcBackend.ts` is what makes this possible without a Rust attachment: `applyParams` and
`scriptHashV3` over Evolution's own UPLC, and `evalTx` over any injected Evolution `Evaluator`.
⚠️ Deep-import only, never from the barrel — `evalTx` wants a Plutus VM, which a phone has no
business carrying.
