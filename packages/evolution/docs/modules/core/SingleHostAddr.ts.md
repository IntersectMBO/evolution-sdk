---
title: core/SingleHostAddr.ts
nav_order: 101
parent: Modules
---

## SingleHostAddr overview

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [make](#make)
  - [withBothIPs](#withbothips)
  - [withIPv4](#withipv4)
  - [withIPv6](#withipv6)
- [conversion](#conversion)
  - [fromCBORBytes](#fromcborbytes)
  - [fromCBORHex](#fromcborhex)
  - [toCBORBytes](#tocborbytes)
  - [toCBORHex](#tocborhex)
- [either](#either)
  - [Either (namespace)](#either-namespace)
- [equality](#equality)
  - [equals](#equals)
- [errors](#errors)
  - [SingleHostAddrError (class)](#singlehostaddrerror-class)
- [model](#model)
  - [SingleHostAddr (class)](#singlehostaddr-class)
- [predicates](#predicates)
  - [hasIPv4](#hasipv4)
  - [hasIPv6](#hasipv6)
  - [hasPort](#hasport)
- [schemas](#schemas)
  - [FromCBORBytes](#fromcborbytes-1)
  - [FromCBORHex](#fromcborhex-1)
  - [FromCDDL](#fromcddl)
- [testing](#testing)
  - [arbitrary](#arbitrary)

---

# constructors

## make

Smart constructor for creating SingleHostAddr instances

**Signature**

```ts
export declare const make: (props: {
  port: Option.Option<Port.Port>
  ipv4: Option.Option<IPv4.IPv4>
  ipv6: Option.Option<IPv6.IPv6>
}) => SingleHostAddr
```

Added in v2.0.0

## withBothIPs

Create a SingleHostAddr with both IPv4 and IPv6 addresses.

**Signature**

```ts
export declare const withBothIPs: (port: Option.Option<Port.Port>, ipv4: IPv4.IPv4, ipv6: IPv6.IPv6) => SingleHostAddr
```

Added in v2.0.0

## withIPv4

Create a SingleHostAddr with IPv4 address.

**Signature**

```ts
export declare const withIPv4: (port: Option.Option<Port.Port>, ipv4: IPv4.IPv4) => SingleHostAddr
```

Added in v2.0.0

## withIPv6

Create a SingleHostAddr with IPv6 address.

**Signature**

```ts
export declare const withIPv6: (port: Option.Option<Port.Port>, ipv6: IPv6.IPv6) => SingleHostAddr
```

Added in v2.0.0

# conversion

## fromCBORBytes

Convert CBOR bytes to SingleHostAddr (unsafe)

**Signature**

```ts
export declare const fromCBORBytes: (bytes: Uint8Array, options?: CBOR.CodecOptions) => SingleHostAddr
```

Added in v2.0.0

## fromCBORHex

Convert CBOR hex string to SingleHostAddr (unsafe)

**Signature**

```ts
export declare const fromCBORHex: (hex: string, options?: CBOR.CodecOptions) => SingleHostAddr
```

Added in v2.0.0

## toCBORBytes

Convert SingleHostAddr to CBOR bytes (unsafe)

**Signature**

```ts
export declare const toCBORBytes: (input: SingleHostAddr, options?: CBOR.CodecOptions) => Uint8Array
```

Added in v2.0.0

## toCBORHex

Convert SingleHostAddr to CBOR hex string (unsafe)

**Signature**

```ts
export declare const toCBORHex: (input: SingleHostAddr, options?: CBOR.CodecOptions) => string
```

Added in v2.0.0

# either

## Either (namespace)

Either namespace for SingleHostAddr operations that can fail

Added in v2.0.0

# equality

## equals

Check if two SingleHostAddr instances are equal.

**Signature**

```ts
export declare const equals: (a: SingleHostAddr, b: SingleHostAddr) => boolean
```

Added in v2.0.0

# errors

## SingleHostAddrError (class)

Error class for SingleHostAddr related operations.

**Signature**

```ts
export declare class SingleHostAddrError
```

Added in v2.0.0

# model

## SingleHostAddr (class)

Schema for SingleHostAddr representing a network host with IP addresses.
single_host_addr = (0, port/ nil, ipv4/ nil, ipv6/ nil)

**Signature**

```ts
export declare class SingleHostAddr
```

Added in v2.0.0

# predicates

## hasIPv4

Check if the host address has an IPv4 address.

**Signature**

```ts
export declare const hasIPv4: (hostAddr: SingleHostAddr) => boolean
```

Added in v2.0.0

## hasIPv6

Check if the host address has an IPv6 address.

**Signature**

```ts
export declare const hasIPv6: (hostAddr: SingleHostAddr) => boolean
```

Added in v2.0.0

## hasPort

Check if the host address has a port.

**Signature**

```ts
export declare const hasPort: (hostAddr: SingleHostAddr) => boolean
```

Added in v2.0.0

# schemas

## FromCBORBytes

CBOR bytes transformation schema for SingleHostAddr.

**Signature**

```ts
export declare const FromCBORBytes: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.transformOrFail<
    typeof Schema.Uint8ArrayFromSelf,
    Schema.declare<CBOR.CBOR, CBOR.CBOR, readonly [], never>,
    never
  >,
  Schema.transformOrFail<
    Schema.Tuple<
      [
        Schema.Literal<[0n]>,
        Schema.NullOr<typeof Schema.BigIntFromSelf>,
        Schema.NullOr<typeof Schema.Uint8ArrayFromSelf>,
        Schema.NullOr<typeof Schema.Uint8ArrayFromSelf>
      ]
    >,
    Schema.SchemaClass<SingleHostAddr, SingleHostAddr, never>,
    never
  >
>
```

Added in v2.0.0

## FromCBORHex

CBOR hex transformation schema for SingleHostAddr.

**Signature**

```ts
export declare const FromCBORHex: (
  options?: CBOR.CodecOptions
) => Schema.transform<
  Schema.transform<Schema.Schema<string, string, never>, Schema.Schema<Uint8Array, Uint8Array, never>>,
  Schema.transform<
    Schema.transformOrFail<
      typeof Schema.Uint8ArrayFromSelf,
      Schema.declare<CBOR.CBOR, CBOR.CBOR, readonly [], never>,
      never
    >,
    Schema.transformOrFail<
      Schema.Tuple<
        [
          Schema.Literal<[0n]>,
          Schema.NullOr<typeof Schema.BigIntFromSelf>,
          Schema.NullOr<typeof Schema.Uint8ArrayFromSelf>,
          Schema.NullOr<typeof Schema.Uint8ArrayFromSelf>
        ]
      >,
      Schema.SchemaClass<SingleHostAddr, SingleHostAddr, never>,
      never
    >
  >
>
```

Added in v2.0.0

## FromCDDL

CDDL schema for SingleHostAddr.
single_host_addr = (0, port / nil, ipv4 / nil, ipv6 / nil)

**Signature**

```ts
export declare const FromCDDL: Schema.transformOrFail<
  Schema.Tuple<
    [
      Schema.Literal<[0n]>,
      Schema.NullOr<typeof Schema.BigIntFromSelf>,
      Schema.NullOr<typeof Schema.Uint8ArrayFromSelf>,
      Schema.NullOr<typeof Schema.Uint8ArrayFromSelf>
    ]
  >,
  Schema.SchemaClass<SingleHostAddr, SingleHostAddr, never>,
  never
>
```

Added in v2.0.0

# testing

## arbitrary

FastCheck arbitrary for generating random SingleHostAddr instances

**Signature**

```ts
export declare const arbitrary: FastCheck.Arbitrary<SingleHostAddr>
```

Added in v2.0.0
