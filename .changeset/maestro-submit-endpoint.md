---
"@evolution-sdk/evolution": patch
---

Fix the Maestro provider host and transaction submission endpoint. Submission posted to `/submit` (or `/turbo/submit` with `turboSubmit`), but Maestro accepts transactions through its Transaction Manager API at `/txmanager` and `/txmanager/turbosubmit`, so every submit returned a 404. The pre-configured `mainnet`, `preprod`, and `preview` constructors also pointed at `*.api.maestro.org`, which does not serve the Cardano API; they now use `https://{network}.gomaestro-api.org/v1`, affecting every request the provider makes, not just submission.
