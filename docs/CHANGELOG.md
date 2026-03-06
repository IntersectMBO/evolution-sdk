# docs

## 0.0.29

### Patch Changes

- Updated dependencies [[`a4fbd49`](https://github.com/IntersectMBO/evolution-sdk/commit/a4fbd49410b65a831d3d84091cfe11ba6b730ee8)]:
  - @evolution-sdk/evolution@0.3.22
  - @evolution-sdk/devnet@1.1.22

## 0.0.28

### Patch Changes

- Updated dependencies [[`38a460f`](https://github.com/IntersectMBO/evolution-sdk/commit/38a460f7a58212a42c720e3d165456bdee9ce505)]:
  - @evolution-sdk/evolution@0.3.21
  - @evolution-sdk/devnet@1.1.21

## 0.0.27

### Patch Changes

- Updated dependencies [[`e0245ae`](https://github.com/IntersectMBO/evolution-sdk/commit/e0245ae2d33c1712591bc26504928c6797a6a668), [`eebd2b0`](https://github.com/IntersectMBO/evolution-sdk/commit/eebd2b0c826f25d96244943da1b28f9b2cefd3e4)]:
  - @evolution-sdk/evolution@0.3.20
  - @evolution-sdk/devnet@1.1.20

## 0.0.26

### Patch Changes

- Updated dependencies [[`e032384`](https://github.com/IntersectMBO/evolution-sdk/commit/e032384da83205f23a3d7358d60776b3b220f810)]:
  - @evolution-sdk/evolution@0.3.19
  - @evolution-sdk/devnet@1.1.19

## 0.0.25

### Patch Changes

- Updated dependencies [[`16fdf5d`](https://github.com/IntersectMBO/evolution-sdk/commit/16fdf5df0587d373c8006437bfc26a9c60b657ee), [`d31f1d4`](https://github.com/IntersectMBO/evolution-sdk/commit/d31f1d43a9555b9dfda244867c4c1173b3298bde)]:
  - @evolution-sdk/evolution@0.3.18
  - @evolution-sdk/devnet@1.1.18

## 0.0.24

### Patch Changes

- Updated dependencies [[`25ebda0`](https://github.com/IntersectMBO/evolution-sdk/commit/25ebda0a7812571d412abf8ba46830c688a80e15)]:
  - @evolution-sdk/evolution@0.3.17
  - @evolution-sdk/devnet@1.1.17

## 0.0.23

### Patch Changes

- Updated dependencies [[`63c8491`](https://github.com/IntersectMBO/evolution-sdk/commit/63c84919b79690dc3b108616bb84fbd3841f09b7)]:
  - @evolution-sdk/evolution@0.3.16
  - @evolution-sdk/devnet@1.1.16

## 0.0.22

### Patch Changes

- Updated dependencies [[`d801fa1`](https://github.com/IntersectMBO/evolution-sdk/commit/d801fa1ce89c4cdea70cb19c4efa919446dadcaa)]:
  - @evolution-sdk/evolution@0.3.15
  - @evolution-sdk/devnet@1.1.15

## 0.0.21

### Patch Changes

- Updated dependencies [[`d21109b`](https://github.com/IntersectMBO/evolution-sdk/commit/d21109b3f42bdee33f1c8e3ecf274ca04735f8f5)]:
  - @evolution-sdk/evolution@0.3.14
  - @evolution-sdk/devnet@1.1.14

## 0.0.20

### Patch Changes

- Updated dependencies [[`2742e40`](https://github.com/IntersectMBO/evolution-sdk/commit/2742e40ea0e62cd75d2a958bed0b6ff6138ded59)]:
  - @evolution-sdk/evolution@0.3.13
  - @evolution-sdk/devnet@1.1.13

## 0.0.19

### Patch Changes

- Updated dependencies [[`15be602`](https://github.com/IntersectMBO/evolution-sdk/commit/15be602a53dfcf59b8f0ccec55081904eaf7ff89), [`8b8ade7`](https://github.com/IntersectMBO/evolution-sdk/commit/8b8ade75f51dd1103dcf4b3714f0012d8e430725)]:
  - @evolution-sdk/evolution@0.3.12
  - @evolution-sdk/devnet@1.1.12

## 0.0.18

### Patch Changes

- Updated dependencies [[`079fd98`](https://github.com/IntersectMBO/evolution-sdk/commit/079fd98c2a1457b2d0fa2417d6e29ef996b59411)]:
  - @evolution-sdk/devnet@1.1.11
  - @evolution-sdk/evolution@0.3.11

## 0.0.17

### Patch Changes

- [#120](https://github.com/IntersectMBO/evolution-sdk/pull/120) [`ed9bdc0`](https://github.com/IntersectMBO/evolution-sdk/commit/ed9bdc07011bcc4875b61fdd6b4f8e4219bb67e4) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add governance and pool operation APIs to transaction builder

  This release adds comprehensive support for Conway-era governance operations and stake pool management:

  **New Delegation APIs**
  - `delegateToPool`: Delegate stake to a pool (with optional registration)
  - `delegateToDRep`: Delegate voting power to a DRep (with optional registration)
  - `delegateToPoolAndDRep`: Delegate to both pool and DRep simultaneously

  **DRep Operations**
  - `registerDRep`: Register as a Delegated Representative
  - `updateDRep`: Update DRep anchor/metadata
  - `deregisterDRep`: Deregister DRep and reclaim deposit

  **Constitutional Committee Operations**
  - `authCommitteeHot`: Authorize hot credential for committee member
  - `resignCommitteeCold`: Resign from constitutional committee

  **Stake Pool Operations**
  - `registerPool`: Register a new stake pool with parameters
  - `retirePool`: Retire a stake pool at specified epoch

  **Transaction Balance Improvements**
  - Proper accounting for certificate deposits and refunds
  - Withdrawal balance calculations
  - Minimum 1 input requirement enforcement (replay attack prevention)

- Updated dependencies [[`ed9bdc0`](https://github.com/IntersectMBO/evolution-sdk/commit/ed9bdc07011bcc4875b61fdd6b4f8e4219bb67e4)]:
  - @evolution-sdk/devnet@1.1.10
  - @evolution-sdk/evolution@0.3.10

## 0.0.16

### Patch Changes

- Updated dependencies [[`0503b96`](https://github.com/IntersectMBO/evolution-sdk/commit/0503b968735bc221b3f4d005d5c97ac8a0a1c592)]:
  - @evolution-sdk/devnet@1.1.9
  - @evolution-sdk/evolution@0.3.9

## 0.0.15

### Patch Changes

- Updated dependencies [[`7905507`](https://github.com/IntersectMBO/evolution-sdk/commit/79055076ab31214dc4c7462553484e9c2bcaf22c)]:
  - @evolution-sdk/evolution@0.3.8
  - @evolution-sdk/devnet@1.1.8

## 0.0.14

### Patch Changes

- Updated dependencies [[`c59507e`](https://github.com/IntersectMBO/evolution-sdk/commit/c59507eafd942cd5bce1d3608c9c3e9c99a4cac8), [`9ddc79d`](https://github.com/IntersectMBO/evolution-sdk/commit/9ddc79dbc9b6667b3f2981dd06875878d9ad14f5), [`0730f23`](https://github.com/IntersectMBO/evolution-sdk/commit/0730f2353490ff1fa75743cccc0d05b33cff1b23)]:
  - @evolution-sdk/evolution@0.3.7
  - @evolution-sdk/devnet@1.1.7

## 0.0.13

### Patch Changes

- Updated dependencies [[`1e1aec8`](https://github.com/IntersectMBO/evolution-sdk/commit/1e1aec88dfc726ff66809f51671d80b3f469eb5c)]:
  - @evolution-sdk/evolution@0.3.6
  - @evolution-sdk/devnet@1.1.6

## 0.0.12

### Patch Changes

- Updated dependencies [[`98b59fa`](https://github.com/IntersectMBO/evolution-sdk/commit/98b59fa49d5a4e454e242a9c400572677e2f986f)]:
  - @evolution-sdk/devnet@1.1.5
  - @evolution-sdk/evolution@0.3.5

## 0.0.11

### Patch Changes

- Updated dependencies [[`aaf0882`](https://github.com/IntersectMBO/evolution-sdk/commit/aaf0882e280fad9769410a81419ebf1c6af48785), [`65b7259`](https://github.com/IntersectMBO/evolution-sdk/commit/65b7259b8b250b87d5420bca6458a5e862ba9406), [`c26391a`](https://github.com/IntersectMBO/evolution-sdk/commit/c26391a3783a5dca95b2ab1b2af95c98c62e4966)]:
  - @evolution-sdk/devnet@1.1.4
  - @evolution-sdk/evolution@0.3.4

## 0.0.10

### Patch Changes

- Updated dependencies [[`ef563f3`](https://github.com/IntersectMBO/evolution-sdk/commit/ef563f305879e6e7411d930a87733cc4e9f34314)]:
  - @evolution-sdk/devnet@1.1.3
  - @evolution-sdk/evolution@0.3.3

## 0.0.9

### Patch Changes

- Updated dependencies [[`61ffded`](https://github.com/IntersectMBO/evolution-sdk/commit/61ffded47892f12bda6f538e8028b3fd64492187), [`7edb423`](https://github.com/IntersectMBO/evolution-sdk/commit/7edb4237059b39815241823cf46ce3bf128e7600)]:
  - @evolution-sdk/evolution@0.3.2
  - @evolution-sdk/devnet@1.1.2

## 0.0.8

### Patch Changes

- Updated dependencies [[`5ee95bc`](https://github.com/IntersectMBO/evolution-sdk/commit/5ee95bc78220c9aa72bda42954b88e47c81a23eb)]:
  - @evolution-sdk/evolution@0.3.1
  - @evolution-sdk/devnet@1.1.1

## 0.0.7

### Patch Changes

- Updated dependencies [[`b52e9c7`](https://github.com/IntersectMBO/evolution-sdk/commit/b52e9c7a0b21c166fe9c3463539a1ff277035ee8)]:
  - @evolution-sdk/devnet@1.1.0

## 0.0.6

### Patch Changes

- Updated dependencies [[`1f0671c`](https://github.com/IntersectMBO/evolution-sdk/commit/1f0671c068d44c1f88e677eb2d8bb55312ff2c38)]:
  - @evolution-sdk/evolution@0.3.0
  - @evolution-sdk/devnet@1.0.0

## 0.0.5

### Patch Changes

- Updated dependencies [[`ea9ffbe`](https://github.com/IntersectMBO/evolution-sdk/commit/ea9ffbe11a8b6a8e97c1531c108d5467a7eda6a8)]:
  - @evolution-sdk/evolution@0.2.5

## 0.0.4

### Patch Changes

- Updated dependencies [[`5b735c8`](https://github.com/IntersectMBO/evolution-sdk/commit/5b735c856fac3562f0e5892bf84c841b1dc85281)]:
  - @evolution-sdk/evolution@0.2.4

## 0.0.3

### Patch Changes

- Updated dependencies [[`29c3e4d`](https://github.com/IntersectMBO/evolution-sdk/commit/29c3e4d3bac9b35c1586c6a94d6aee037aeb6d62)]:
  - @evolution-sdk/evolution@0.2.3

## 0.0.2

### Patch Changes

- Updated dependencies [[`7bb1da3`](https://github.com/IntersectMBO/evolution-sdk/commit/7bb1da32488c5a1a92a9c8b90e5aa4514e004232), [`844dfec`](https://github.com/IntersectMBO/evolution-sdk/commit/844dfeccb48c0af0ce0cebfc67e6cdcc67e28cc8)]:
  - @evolution-sdk/evolution@0.2.2

## 0.0.1

### Patch Changes

- Updated dependencies [[`0dcf415`](https://github.com/IntersectMBO/evolution-sdk/commit/0dcf4155e7950ff46061100300355fb0a69e902d)]:
  - @evolution-sdk/evolution@0.2.1
