import * as fs from "node:fs"
import * as path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * No module-scope declaration may shadow a global that a transpiler's own helpers reference.
 *
 * This is a static check because the failure it guards against cannot be reproduced at runtime
 * here: it only exists once the code has been through Babel. `TSchema` exported combinators named
 * `Array`, `Map` and `Boolean`, and the file carefully said `globalThis.Array` everywhere because
 * of it — but Babel's rest-parameter prologue emits a bare `Array`:
 *
 *   for (var n = arguments.length, t = new Array(n), i = 0; i < n; i++) t[i] = arguments[i]
 *
 * In `Union(...members)` that `new Array(n)` built a schema object instead of an array, so every
 * caller of `Union` or `Variant` broke — `members.map is not a function` under a Metro bundle in
 * Node, `TypeError: Function is not a constructor` on Hermes, and on React Native the throw landed
 * during module init and took down the entire app.
 *
 * `node`, `bun` and `vitest` all run the native rest parameter and never emit the prologue, which
 * is why the whole suite passed throughout.
 *
 * Declare such a combinator under an internal name and re-export it:
 *   const ArrayCombinator = …
 *   export { ArrayCombinator as Array }
 */
describe("no module-scope binding shadows a transpiler-visible global", () => {
  // Globals a transpiler's GENERATED code references by bare name. `Array` is the one that bit:
  // the rest-parameter and spread helpers both construct one. `Object` and `Symbol` appear in the
  // class, spread and interop helpers.
  //
  // Deliberately NOT listed: `Map`, `Set`, `Boolean`, `String`, `Number`, `Promise`. Nothing Babel
  // emits constructs them, and `TSchema`/`DataJson` export combinators under two of those names
  // whose type and value must merge — splitting them to satisfy a hazard no transpiler exercises
  // costs more than it buys. Add one here the moment a helper is found that emits it.
  const RISKY = ["Array", "Object", "Symbol"]

  const sources = () => {
    const out: Array<string> = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".ts")) out.push(full)
      }
    }
    walk(path.resolve(__dirname, "../src"))
    return out
  }

  it("declares none of them at module scope", () => {
    const offenders: Array<string> = []
    for (const file of sources()) {
      const text = fs.readFileSync(file, "utf8")
      for (const name of RISKY) {
        // A module-scope `const`/`let`/`function`/`class` by that name, exported or not.
        const declared = new RegExp(`^(?:export\\s+)?(?:const|let|function|class)\\s+${name}\\b`, "m")
        if (declared.test(text)) {
          offenders.push(`${path.relative(path.resolve(__dirname, ".."), file)} declares ${name}`)
        }
      }
    }
    expect(offenders).toStrictEqual([])
  })
})
