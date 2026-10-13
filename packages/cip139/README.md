# @evolution-sdk/cip139

The CIP-139 Universal Query Layer: the read surface that turns an own-data wallet into a
**full-data** one.

CIP-30 serves the user's own addresses and UTxOs, which leaves a dApp with two sources of truth —
its own query layer and the wallet's — and they can disagree, so the wallet may refuse to sign a
transaction spending a UTxO it has not seen. CIP-139 lets the wallet answer for arbitrary chain
data instead. Method names are the operation names from `cip-0144.md` verbatim, so a JSON-RPC
transport can use them unmodified (`cip139_getUtxosByAddress`).

```ts
import { QueryLayer } from "@evolution-sdk/cip139"
import { Koios } from "@evolution-sdk/evolution/sdk/provider/Koios"
import { Decode } from "@evolution-sdk/review"
import { Provider } from "@evolution-sdk/evolution"
import { Effect, Layer } from "effect"

const koios = new Koios("https://preprod.koios.rest/api/v1")
const layer = QueryLayer.makeQueryLayer()

const pools = await Effect.runPromise(
  layer.getAllPools().pipe(
    Effect.provide(Layer.merge(Layer.succeed(Provider.ProviderEffect, koios.effect), Decode.layer))
  )
)
```

## Scope: 20 of 30 operations

The ten that are absent all return the recursive CIP-116 domain types — `Transaction`, `Block`,
`PlutusData` by hash, `NativeScript`, `TransactionMetadatum` — or, in one case, a shape no indexer
can answer. Each is listed in `Types.UNIMPLEMENTED` with its reason, so "not here" is never
mistaken for "not needed".

⚠️ `getEraBySummary` is **not answerable from an indexer** at all: `EraSummary` requires
start, end and parameters, `EraParameters` requires `safe_zone` (which no indexer reports), and the
current era has no `end`. It would have to be fabricated.

## Probe before you advertise

Every chain-wide read this layer needs is an **optional** member of `ProviderEffect`. A wallet
advertising `{cip: 139}` is telling a dApp it can stop bringing its own query layer, so the claim
has to be true of the backend actually wired in:

```ts
if (QueryLayer.supportsQueryLayer(provider.effect)) { /* advertise the extension */ }
```

An operation whose member is missing fails naming **both** sides — the operation and the member it
wanted — rather than returning an empty list, which reads like "the chain has none".

⚠️ `getAccountInfo` is deliberately not in `QUERY_LAYER_MEMBERS`. Only `getDrepByStakeCredential`
needs it, so a provider without it serves nineteen of the twenty operations, and withholding the
whole extension for one of them would be the worse answer.

## What this layer owns, because nothing else can

**Enum translation.** The CIP's enums and a backend's spellings differ in ways that silently
produce schema-invalid JSON: `Yes` → `yes`, Koios's US `authorized` → the CIP's British
`authorised`, `registered` → `active`. An unrecognised value **fails** here, naming it, rather
than being passed through.

**Exactness.** `UnitInterval` is `{numerator, denominator}`, and the provider tier carries the
thresholds and prices as `UnitInterval` / `NonnegativeInterval` — so nothing on this path goes
through a float. `Provider.ProtocolParameters` reports `priceMem` and `minFeeRefScriptCostPerByte`
as `number`, which is right for a fee calculation and lossy for a parameter that must be re-emitted;
`Provider.ChainParameters` carries the exact form, and that is the one this layer reads.

**Original bytes.** A UTxO's inline datum is emitted both as `plutus_data` (the CIP-116 tree the
spec asks for) and as `datum_hex` — the datum exactly as the chain carries it. The tree alone is
not enough for a consumer that must hash or re-submit it: the encoder writes an empty Plutus array
definite whatever framing it parsed, and a datum that re-encodes differently hashes differently.
`datum_hex` is emitted only when the provider **preserved** those bytes (`InlineDatum.raw`);
re-deriving one would be the fabrication the field exists to prevent.

## The gap fillers, which are NOT CIP-139

`makeQueryExperimental()` carries two things a transaction-building dApp needs and the CIP does not
define. They belong under CIP-30's `api.experimental.*` namespace, never beside the standard
surface.

- **`tip`** — CIP-139 has no chain-tip operation at all, so a dApp setting a validity interval is
  still left needing its own backend for the current slot.
- **`resolveOutpoints`** — 139's per-transaction UTxO query is keyed by transaction hash, so
  resolving N outpoints spread over N transactions costs N round trips. This is the batched form.
  ⚠️ A **spent** outpoint is simply absent from the answer: the provider tier drops consumed
  outputs from `getUtxosByOutRef`, because handing one to a builder produces a transaction the node
  rejects. Membership is the liveness signal.
