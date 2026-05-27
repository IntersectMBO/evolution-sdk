---
"@evolution-sdk/devnet": patch
---

`Cluster.make` now auto-allocates host ports for cardano-node, Kupo, and Ogmios when not specified, so parallel test runs no longer collide on the previous fixed defaults (1442/1337/4001/8090). The returned `Cluster` exposes a new `ports` field with the assigned host ports.

Consumers passing explicit `port` values on `kupo`, `ogmios`, or `ports` keep their existing behavior. Consumers that relied on the previous fixed defaults should read the assigned port from `cluster.ports.kupo`, `cluster.ports.ogmios`, `cluster.ports.node`, and `cluster.ports.submit` instead.

Container starts now retry with exponential backoff to absorb transient Docker daemon pressure when many containers come up at once.
