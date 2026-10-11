---

title: InlineDatum.ts
nav_order: 68
parent: Modules
---

## InlineDatum overview

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [fromCBORBytes](#fromcborbytes)
  - [fromCBORHex](#fromcborhex)
- [predicates](#predicates)
  - [isInlineDatum](#isinlinedatum)
- [schemas](#schemas)
  - [InlineDatum (class)](#inlinedatum-class)
    - [toJSON (method)](#tojson-method)
    - [toString (method)](#tostring-method)
    - [[Inspectable.NodeInspectSymbol] (method)](#inspectablenodeinspectsymbol-method)
    - [[Equal.symbol] (method)](#equalsymbol-method)
    - [[Hash.symbol] (method)](#hashsymbol-method)
- [testing](#testing)
  - [arbitrary](#arbitrary)

---

# constructors

## fromCBORBytes

As {@link fromCBORHex}, for bytes already decoded from the wire.

**Signature**

```ts
export declare const fromCBORBytes: (bytes: Uint8Array) => InlineDatum
```

Added in v2.7.0

## fromCBORHex

An inline datum from the CBOR a backend sent, KEEPING those bytes.

⚠️ **Use this, not the constructor, for any datum that came off a wire.** `new InlineDatum(…)`
records nothing, so the datum's only remaining representation is the decoded tree -- and
re-deriving bytes from a tree reframes an EMPTY indefinite array (`9fff` becomes `80`), which
changes the hash. A script consumer matches a datum BY its hash, and `cip113`/`cip139` report
`datum_hex` only from the `OriginalBytes` channel, absent rather than re-derived.

Every provider that reads a datum off a backend goes through here, so "the bytes survive" is
one decision in one place rather than four copies that can each be forgotten -- which is how
three of those four came to drop them.

**Signature**

```ts
export declare const fromCBORHex: (hex: string) => InlineDatum
```

Added in v2.7.0

# predicates

## isInlineDatum

Type guard to check if a value is an InlineDatum.

**Signature**

```ts
export declare const isInlineDatum: (u: unknown, overrideOptions?: ParseOptions | number) => u is InlineDatum
```

Added in v2.0.0

# schemas

## InlineDatum (class)

Schema for InlineDatum representing inline plutus data embedded directly in the transaction output.

**Signature**

```ts
export declare class InlineDatum
```

Added in v2.0.0

### toJSON (method)

**Signature**

```ts
toJSON()
```

Added in v2.0.0

### toString (method)

**Signature**

```ts
toString(): string
```

Added in v2.0.0

### [Inspectable.NodeInspectSymbol] (method)

**Signature**

```ts
[Inspectable.NodeInspectSymbol](): unknown
```

Added in v2.0.0

### [Equal.symbol] (method)

**Signature**

```ts
[Equal.symbol](that: unknown): boolean
```

Added in v2.0.0

### [Hash.symbol] (method)

**Signature**

```ts
[Hash.symbol](): number
```

Added in v2.0.0

# testing

## arbitrary

FastCheck arbitrary for generating random InlineDatum instances.

**Signature**

```ts
export declare const arbitrary: Arbitrary<InlineDatum>
```

Added in v2.0.0
