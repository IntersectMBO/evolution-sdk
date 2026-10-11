# @evolution-sdk/backup-keys

A password-encrypted, authenticated envelope for moving a wallet secret between applications,
with a JSON-file, `web+cardano:` link and QR binding.

**This is not a ratified CIP.** It implements a draft submitted for a number; until one is
assigned, nothing here claims a CIP it does not hold.

| module | what it is |
|---|---|
| `EncryptedExport` | Argon2id over the password, XChaCha20-Poly1305 over the payload, in a self-describing envelope |

## What it is careful about

**One KDF profile, pinned at the import boundary.** The Argon2id cost travels inside the
envelope, so `parse`/`parseLink` require the single v1 profile exactly: an absurd memory cost is a
denial of service rather than a backup, and a *weaker* one would lower the format's floor to
whatever an exporter felt like paying. `decrypt` takes an already-typed envelope and enforces the
ceiling rather than the equality, so it honours a cheaper profile a caller hands it deliberately.

**A password is bytes.** It is hashed as the UTF-8 it was given, with no trim, case-fold or
Unicode normalisation — whitespace is content. An empty password is refused outright.

**The derivation is async.** 256 MiB of Argon2id would otherwise block a single-threaded host
(React Native's Hermes, a browser main thread) for seconds.

**`payloadType` is a hint, not a fact.** It sits outside the AEAD, so it is checked against the
decrypted payload rather than trusted; a reader that trusted it could route a root key through
the mnemonic path.

```ts
import { EncryptedExport } from "@evolution-sdk/backup-keys"
import { Effect } from "effect"

const { envelope, link } = await Effect.runPromise(EncryptedExport.encrypt(payload, password))
const back = Effect.runSync(EncryptedExport.parseLink(link))
const secret = await Effect.runPromise(EncryptedExport.decrypt(back, password))
```
