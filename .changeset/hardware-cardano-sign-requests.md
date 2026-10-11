---
"@evolution-sdk/hardware-cardano": minor
---

New package: build a Ledger or Trezor Cardano sign request from a reviewed transaction body.

It takes `@evolution-sdk/review`'s `Inspect.TxBodyView` and produces the parameter shape each device expects. No vendor SDK, no transport, no WebUSB/HID environment — the request is data, and this package only builds it, so it can be tested without a device attached.

**Anything unrepresentable is refused, by name.** The device recomputes the body hash from the request it is handed, so a converter that silently dropped a field it could not represent would obtain a signature over a different transaction than the one the user approved. Refused: a body-map key the review tier cannot name, and proposal procedures, on both devices; voting procedures, treasury and donation fields, Byron outputs and governance certificates beyond vote delegation, on Trezor; pool, combined staking-plus-governance, and deprecated certificates, on Ledger.

Whether the input set arrived `#6.258` or bare travels into the request for the same reason: it changes the bytes the device re-emits, and therefore the hash.
