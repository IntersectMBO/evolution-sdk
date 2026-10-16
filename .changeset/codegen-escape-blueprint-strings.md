---
"@evolution-sdk/evolution": patch
---

Blueprint code generation now escapes blueprint-controlled strings instead of splicing them into the generated TypeScript raw. Validator title, hash and compiled code and constructor tags are emitted as JSON string literals, field and variant names that are not valid identifiers are quoted, and title/description text placed in comments can no longer close the comment early. A crafted blueprint (for example a third party's plutus.json) could previously inject statements into the generated file that would run when a consumer builds or imports it. Output for ordinary blueprints is unchanged.
