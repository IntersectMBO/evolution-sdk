/**
 * RFC 8785 — the JSON Canonicalization Scheme.
 *
 * A leaf: no imports, nothing Cardano-specific. It exists because digests get taken over JSON,
 * and a byte that differs from whoever computed the original digest is a rejected payment or a
 * failed signature check.
 *
 * ⚠️ This is **not** JSON-LD / RDF-Dataset canonicalization (URDNA2015), which governance
 * metadata uses and which needs a full JSON-LD to N-Quads stack. JCS is flat and
 * self-contained: sort keys, emit shortest escapes, use ECMAScript number formatting.
 *
 * ⚠️ It is also not {@link Cip116}. CIP-116 is a canonical *shape* for Cardano objects — which
 * fields are strings and which are numbers. JCS is a canonical *encoding* of whatever shape it
 * is handed. They compose.
 *
 * @since 0.1.0
 */

export class JcsError extends Error {
  readonly _tag = "JcsError"
  constructor(reason: string) {
    super(reason)
    this.name = "JcsError"
  }
}

/**
 * RFC 8785 §3.2.2.2 string serialization: the two mandatory escapes, the five
 * short forms, `\u00xx` for the remaining C0 controls, and every other code point
 * literal.
 *
 * DEL (0x7f) is deliberately NOT escaped — RFC 8785 defers to RFC 8259, which only
 * requires escaping below 0x20. Escaping it would produce a digest nobody else
 * computes.
 */
const serializeString = (s: string): string => {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    switch (c) {
      case 0x22:
        out += '\\"'
        continue
      case 0x5c:
        out += "\\\\"
        continue
      case 0x08:
        out += "\\b"
        continue
      case 0x0c:
        out += "\\f"
        continue
      case 0x0a:
        out += "\\n"
        continue
      case 0x0d:
        out += "\\r"
        continue
      case 0x09:
        out += "\\t"
        continue
      default:
        break
    }
    if (c < 0x20) {
      out += `\\u${c.toString(16).padStart(4, "0")}`
      continue
    }
    // Surrogate pairing. RFC 8785 requires canonicalization to FAIL on data that
    // is not valid Unicode: a lone surrogate has no UTF-8 encoding, so hashing it
    // would hash a replacement character and silently agree with nobody.
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new JcsError(`unpaired high surrogate U+${c.toString(16).toUpperCase()} at index ${i}`)
      }
      out += s[i]! + s[i + 1]!
      i++
      continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      throw new JcsError(`unpaired low surrogate U+${c.toString(16).toUpperCase()} at index ${i}`)
    }
    out += s[i]!
  }
  return out + '"'
}

/**
 * RFC 8785 §3.2.2.3 number serialization. The spec defers to ECMAScript's
 * `Number::toString`, which is exactly what `JSON.stringify` emits for a finite
 * number — including `1e+21` for large magnitudes and `"0"` for `-0`. Delegating
 * is therefore both correct and the only way to avoid reimplementing shortest
 * round-trip float printing.
 */
const serializeNumber = (n: number): string => {
  if (!Number.isFinite(n)) throw new JcsError(`${n} has no JSON representation (RFC 8785 requires finite numbers)`)
  return JSON.stringify(n) as string
}

/**
 * Canonical JSON text for `value`, per RFC 8785.
 *
 * Object keys are sorted on their UTF-16 code units, which is what JavaScript's
 * default string comparison already does — the spec chose that order precisely so
 * a JS implementation needs no custom comparator.
 *
 * Rejects rather than guesses:
 * - `bigint` — JSON has no bigint, and coercing to a double would corrupt the
 *   digest for exactly the large integers Cardano deals in. Stringify it yourself,
 *   which is what every x402 amount field already does.
 * - `NaN` / `±Infinity`, and lone surrogates (see {@link serializeString}).
 * - `undefined`, functions and symbols at the top level or inside an array; inside
 *   an object they are skipped, matching `JSON.stringify`.
 */
export function jcs(value: unknown): string {
  return write(value, new Set(), "$")
}

const write = (value: unknown, seen: Set<object>, path: string): string => {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "number":
      return serializeNumber(value)
    case "string":
      return serializeString(value)
    case "bigint":
      throw new JcsError(
        `bigint at ${path} has no JSON representation; encode it as a string (JSON numbers are IEEE doubles and would lose precision)`
      )
    case "undefined":
    case "function":
    case "symbol":
      throw new JcsError(`${typeof value} at ${path} has no JSON representation`)
    default:
      break
  }
  const obj = value as object
  // A cycle would otherwise recurse until the stack dies; name the path instead.
  if (seen.has(obj)) throw new JcsError(`circular reference at ${path}`)
  seen.add(obj)
  try {
    // `toJSON` first, so Date and friends canonicalize the way JSON.stringify
    // would see them rather than as `{}`.
    const tj = (obj as { toJSON?: (key?: string) => unknown }).toJSON
    if (typeof tj === "function") return write(tj.call(obj), seen, path)

    if (Array.isArray(obj)) {
      return `[${obj.map((item, i) => write(item, seen, `${path}[${i}]`)).join(",")}]`
    }
    const rec = obj as Record<string, unknown>
    const keys = Object.keys(rec)
      .filter((k) => {
        const v = rec[k]
        return !(v === undefined || typeof v === "function" || typeof v === "symbol")
      })
      .sort()
    return `{${keys.map((k) => `${serializeString(k)}:${write(rec[k], seen, `${path}.${k}`)}`).join(",")}}`
  } finally {
    seen.delete(obj)
  }
}

/** UTF-8 bytes of {@link jcs} — what a digest is actually taken over. */
export const jcsBytes = (value: unknown): Uint8Array => new TextEncoder().encode(jcs(value))
