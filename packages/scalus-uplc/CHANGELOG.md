# @evolution-sdk/scalus-uplc

## 0.0.12

### Patch Changes

- Updated dependencies [[`a4fbd49`](https://github.com/IntersectMBO/evolution-sdk/commit/a4fbd49410b65a831d3d84091cfe11ba6b730ee8)]:
  - @evolution-sdk/evolution@0.3.22

## 0.0.11

### Patch Changes

- Updated dependencies [[`38a460f`](https://github.com/IntersectMBO/evolution-sdk/commit/38a460f7a58212a42c720e3d165456bdee9ce505)]:
  - @evolution-sdk/evolution@0.3.21

## 0.0.10

### Patch Changes

- [#170](https://github.com/IntersectMBO/evolution-sdk/pull/170) [`26dfe7e`](https://github.com/IntersectMBO/evolution-sdk/commit/26dfe7edaebaf38087ccd6d367a226369dda2a01) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix CJS interop: use default import for scalus package to resolve TypeError: Scalus.SlotConfig is not a constructor

- Updated dependencies [[`e0245ae`](https://github.com/IntersectMBO/evolution-sdk/commit/e0245ae2d33c1712591bc26504928c6797a6a668), [`eebd2b0`](https://github.com/IntersectMBO/evolution-sdk/commit/eebd2b0c826f25d96244943da1b28f9b2cefd3e4)]:
  - @evolution-sdk/evolution@0.3.20

## 0.0.9

### Patch Changes

- Updated dependencies [[`e032384`](https://github.com/IntersectMBO/evolution-sdk/commit/e032384da83205f23a3d7358d60776b3b220f810)]:
  - @evolution-sdk/evolution@0.3.19

## 0.0.8

### Patch Changes

- Updated dependencies [[`16fdf5d`](https://github.com/IntersectMBO/evolution-sdk/commit/16fdf5df0587d373c8006437bfc26a9c60b657ee), [`d31f1d4`](https://github.com/IntersectMBO/evolution-sdk/commit/d31f1d43a9555b9dfda244867c4c1173b3298bde)]:
  - @evolution-sdk/evolution@0.3.18

## 0.0.7

### Patch Changes

- Updated dependencies [[`25ebda0`](https://github.com/IntersectMBO/evolution-sdk/commit/25ebda0a7812571d412abf8ba46830c688a80e15)]:
  - @evolution-sdk/evolution@0.3.17

## 0.0.6

### Patch Changes

- Updated dependencies [[`63c8491`](https://github.com/IntersectMBO/evolution-sdk/commit/63c84919b79690dc3b108616bb84fbd3841f09b7)]:
  - @evolution-sdk/evolution@0.3.16

## 0.0.5

### Patch Changes

- Updated dependencies [[`d801fa1`](https://github.com/IntersectMBO/evolution-sdk/commit/d801fa1ce89c4cdea70cb19c4efa919446dadcaa)]:
  - @evolution-sdk/evolution@0.3.15

## 0.0.4

### Patch Changes

- Updated dependencies [[`d21109b`](https://github.com/IntersectMBO/evolution-sdk/commit/d21109b3f42bdee33f1c8e3ecf274ca04735f8f5)]:
  - @evolution-sdk/evolution@0.3.14

## 0.0.3

### Patch Changes

- [#130](https://github.com/IntersectMBO/evolution-sdk/pull/130) [`8494053`](https://github.com/IntersectMBO/evolution-sdk/commit/84940535cee0bd742417c20969f06181ed9cf260) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add publish configuration and package metadata for npm publishing. Includes repository links, keywords, homepage, and publishConfig with public access and provenance settings.

- Updated dependencies [[`2742e40`](https://github.com/IntersectMBO/evolution-sdk/commit/2742e40ea0e62cd75d2a958bed0b6ff6138ded59)]:
  - @evolution-sdk/evolution@0.3.13

## 0.0.2

### Patch Changes

- [#119](https://github.com/IntersectMBO/evolution-sdk/pull/119) [`150fde4`](https://github.com/IntersectMBO/evolution-sdk/commit/150fde4cc73a52b999f89578b07e1e5f4cab0418) Thanks [@sae3023](https://github.com/sae3023)! - # Initial release: Scalus UPLC evaluator

  Add JavaScript-based Plutus script evaluator using Scalus as an alternative to the WASM-based Aiken evaluator.

  ## Features
  - **Pure JavaScript evaluation**: Evaluate Plutus scripts without WASM dependencies
  - **Production-ready**: Scalus v0.14.2 with full Plutus V1/V2/V3 support
  - **Compatible API**: Drop-in replacement for Aiken evaluator with identical interface
  - **Tag mapping**: Automatic translation between Scalus string tags and Evolution RedeemerTag enum

  ## Use Cases
  - Environments where WASM is unavailable or restricted
  - Node.js applications requiring native JavaScript execution
  - Cross-platform compatibility without binary dependencies
  - Alternative evaluation for validation and testing

  ## Package Configuration

  Includes standard workspace integration with proper exports, TypeScript definitions, and ESLint configuration

- Updated dependencies [[`15be602`](https://github.com/IntersectMBO/evolution-sdk/commit/15be602a53dfcf59b8f0ccec55081904eaf7ff89), [`8b8ade7`](https://github.com/IntersectMBO/evolution-sdk/commit/8b8ade75f51dd1103dcf4b3714f0012d8e430725)]:
  - @evolution-sdk/evolution@0.3.12
