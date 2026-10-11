---
"@evolution-sdk/evolution": minor
---

`RequestBudget.RequestReport` carries the refusal's body.

A status is not an identification. Koios answers `429` both for one credential over its own window, whose body reads `Exceeded Burst Limit, count was N`, and for an instance shedding load by source IP, whose body is an HAProxy page. A report that names only the status cannot tell a caller which of those happened, so it cannot say whether to slow down or to try another endpoint.

`refusalBody` is present only for a non-2xx response, and it is read from a clone of the response, so the caller still receives an unread body to fail with. A body that cannot be read leaves the field **absent** rather than reporting an empty string the server never sent.
