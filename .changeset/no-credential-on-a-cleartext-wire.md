---
"@evolution-sdk/evolution": minor
---

A provider request carrying a credential is refused when the endpoint is plain http.

A bearer token, a Blockfrost `project_id` and a Maestro `api-key` are all readable by every hop they cross on an unencrypted connection, and each one is a user's paid tier — or, in a wallet, an identity. The endpoint being misconfigured is not a reason to put it on the wire.

The check lives in the one place that sees both the url and the headers, so it covers every HTTP-backed provider rather than being re-implemented per backend. The request is never issued, so it fails as an `HttpRequestError`, in the error channel. The message names the header, never its value.

⚠️ **Behaviour change.** A provider configured against `http://` with a token now fails instead of sending it. Loopback (`localhost`, `127.0.0.1`, `[::1]`) is exempt, because there is no wire to intercept — a local devnet or a tunnelled indexer keeps working. A LAN address or a plain hostname is not exempt: an indexer one hop away on a shared network is exactly where a token is captured. A provider with no credential is unaffected over any scheme.
