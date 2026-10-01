---
"@evolution-sdk/evolution": patch
---

Encode `Mint`, `MultiAsset` and `Withdrawals` map keys in canonical CBOR order, as CIP-21 requires: policy IDs and reward accounts bytewise, and asset names shorter first, then bytewise. The encoders used insertion order, so a transaction that minted under several policies, or held several policies or asset names in one output, could not be signed by a hardware wallet. The Ledger serializes the body in canonical order itself, so its signature did not match the transaction. Decoded transactions still keep their original key order when they are re-encoded, so their hashes and existing signatures are unchanged.
