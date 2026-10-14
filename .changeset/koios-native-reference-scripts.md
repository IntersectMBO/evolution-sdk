---
"@evolution-sdk/evolution": patch
---

Koios UTxOs no longer lose their native reference scripts. db-sync stores no CBOR for native scripts before the Dijkstra era, so Koios returns `reference_script.bytes: null` for timelock and multisig scripts and `toUTxO` silently came back with no `scriptRef`. Native scripts are now rebuilt from the script JSON in `reference_script.value` and checked against the `hash` Koios reports — a hash mismatch or a value that does not decode as a native script throws a clear error instead of dropping the script. The `multisig` type, which the switch did not handle at all, is also decoded from bytes when they are present.
