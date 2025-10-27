---
title: utils/effect-runtime.ts
nav_order: 162
parent: Modules
---

## effect-runtime overview

---

<h2 class="text-delta">Table of contents</h2>

- [utilities](#utilities)
  - [runEffect](#runeffect)

---

# utilities

## runEffect

Run an Effect and convert it to a Promise with clean error handling.

- Executes the Effect using Effect.runPromiseExit
- On failure, extracts the error from the Exit and cleans stack traces
- Removes Effect.ts internal stack frames for cleaner error messages
- Throws the cleaned error for standard Promise error handling

**Signature**

```ts
export async function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A>
```

**Example**

```typescript
import { Effect } from "effect"
import { runEffect } from "@evolution-sdk/evolution/utils/effect-runtime"

const myEffect = Effect.succeed(42)

async function example() {
  try {
    const result = await runEffect(myEffect)
    console.log(result)
  } catch (error) {
    // Error with clean stack trace, no Effect.ts internals
    console.error(error)
  }
}
```

Added in v2.0.0
