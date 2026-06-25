import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src")

// Files whose Point.BASE multiplications operate on secret key scalars. These
// must use the constant-time `multiply`, never the variable-time
// `multiplyUnsafe`, so the operation timing does not depend on the secret.
const SECRET_SCALAR_FILES = ["PrivateKey.ts", "VKey.ts", "Bip32PrivateKey.ts"]

describe("constant-time secret scalar multiplication", () => {
  it.each(SECRET_SCALAR_FILES)("%s must not use multiplyUnsafe on secret scalars", (file) => {
    const source = readFileSync(join(srcDir, file), "utf8")
    expect(source).not.toContain("multiplyUnsafe")
  })

  it("multiply and multiplyUnsafe produce identical points for a valid scalar", () => {
    // The swap must not change results for valid (non-zero) scalars.
    const scalar = 0x1cca3b06f9b9b8f0e2b3a1d4c5e6f70819283746556473829100aabbccddeeffn % ed25519.Point.Fn.ORDER
    const constantTime = ed25519.Point.BASE.multiply(scalar).toBytes()
    const variableTime = ed25519.Point.BASE.multiplyUnsafe(scalar).toBytes()
    expect(constantTime).toEqual(variableTime)
  })
})
