---
"@evolution-sdk/backup-keys": minor
---

New package: a password-encrypted, authenticated envelope for moving a wallet secret between applications, with a JSON-file, `web+cardano:` link and QR binding.

⚠️ **Not a ratified CIP.** It implements a draft submitted for a number; until one is assigned, nothing in the package claims a CIP it does not hold.

`EncryptedExport` is Argon2id over the password and XChaCha20-Poly1305 over the payload, in a self-describing envelope. What it is careful about:

- **One KDF profile, pinned at the import boundary.** The Argon2id cost travels inside the envelope, so `parse` / `parseLink` require the single v1 profile exactly: an absurd memory cost is a denial of service rather than a backup, and a *weaker* one would lower the format's floor to whatever an exporter felt like paying. `decrypt` takes an already-typed envelope and enforces the ceiling rather than the equality, so a cheaper profile a caller hands it deliberately is still honoured.
- **A password is bytes.** It is hashed as the UTF-8 it was given — no trim, no case-fold, no Unicode normalisation, because whitespace is content and a trimmed password derives a different key. An empty password is refused outright.
- **The derivation is async**, because 256 MiB of Argon2id blocks a single-threaded host for seconds.
