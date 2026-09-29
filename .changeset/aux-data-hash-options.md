---
"@evolution-sdk/evolution": patch
---

Add an optional codec options argument to `AuxiliaryData.toHash`. The function always hashed the default encoding. A caller that serialized a transaction with canonical or custom options therefore got an auxiliary data hash that did not match the auxiliary data in that transaction. It now hashes the encoding the given options produce, and without options it returns the same hash as before.
