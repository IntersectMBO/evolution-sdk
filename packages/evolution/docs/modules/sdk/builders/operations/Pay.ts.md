---

title: sdk/builders/operations/Pay.ts
nav_order: 131
parent: Modules
---

## Pay overview

Pay operation - creates transaction outputs to send assets to addresses.

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [programs](#programs)
  - [createPayToAddressProgram](#createpaytoaddressprogram)

---

# programs

## createPayToAddressProgram

Creates a ProgramStep for payToAddress operation.
Creates a UTxO output and tracks assets for balancing.

When `autoMinUtxo` is enabled (via build options or per-call override),
the output lovelace is automatically bumped up to the protocol minimum
if the specified amount is below it. When disabled (the default), the
specified lovelace is used as-is.

Implementation:

1. Resolves autoMinUtxo from per-call override or build options (default: off)
2. When enabled, calculates minimum lovelace and uses the higher of specified/required
3. Creates the UTxO output with the effective assets
4. Adds output to state.outputs array
5. Updates totalOutputAssets for balancing

**Signature**

```ts
export declare const createPayToAddressProgram: (
  params: PayToAddressParams
) => Effect.Effect<void, TransactionBuilderError, TxContext | BuildOptionsTag | ProtocolParametersTag>
```

Added in v2.0.0
