import { Schema } from "effect"

/**
 * JSON codec preserving 64-bit Cardano amounts: `JSON.parse` rounds unquoted
 * integers past 2^53-1, and lovelace and token quantities are uint64. `parse`
 * decodes those as bigint, `stringify` writes them back as bare numeric
 * literals — the shape Kupo, Ogmios and Blockfrost's evaluate endpoint expect.
 */

const isWhitespace = (ch: string): boolean => ch === " " || ch === "\n" || ch === "\r" || ch === "\t"

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9"

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t"
}

class Parser {
  private index = 0

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace()
    const value = this.parseValue()
    this.skipWhitespace()
    if (this.index < this.text.length) {
      throw new SyntaxError(`Unexpected token at position ${this.index} in lossless JSON`)
    }
    return value
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && isWhitespace(this.text[this.index]!)) {
      this.index++
    }
  }

  private expect(ch: string): void {
    if (this.text[this.index] !== ch) {
      throw new SyntaxError(`Expected '${ch}' at position ${this.index} in lossless JSON`)
    }
    this.index++
  }

  private parseValue(): unknown {
    const ch = this.text[this.index]
    if (ch === undefined) {
      throw new SyntaxError("Unexpected end of lossless JSON input")
    }
    switch (ch) {
      case "{":
        return this.parseObject()
      case "[":
        return this.parseArray()
      case '"':
        return this.parseString()
      case "t":
        return this.parseLiteral("true", true)
      case "f":
        return this.parseLiteral("false", false)
      case "n":
        return this.parseLiteral("null", null)
      default:
        return this.parseNumber()
    }
  }

  private parseLiteral<A>(literal: string, value: A): A {
    if (this.text.startsWith(literal, this.index)) {
      this.index += literal.length
      return value
    }
    throw new SyntaxError(`Unexpected token at position ${this.index} in lossless JSON`)
  }

  private parseObject(): Record<string, unknown> {
    this.expect("{")
    const result: Record<string, unknown> = {}
    this.skipWhitespace()
    if (this.text[this.index] === "}") {
      this.index++
      return result
    }
    for (;;) {
      this.skipWhitespace()
      const key = this.parseString()
      this.skipWhitespace()
      this.expect(":")
      this.skipWhitespace()
      result[key] = this.parseValue()
      this.skipWhitespace()
      if (this.text[this.index] === ",") {
        this.index++
        continue
      }
      this.expect("}")
      return result
    }
  }

  private parseArray(): Array<unknown> {
    this.expect("[")
    const result: Array<unknown> = []
    this.skipWhitespace()
    if (this.text[this.index] === "]") {
      this.index++
      return result
    }
    for (;;) {
      this.skipWhitespace()
      result.push(this.parseValue())
      this.skipWhitespace()
      if (this.text[this.index] === ",") {
        this.index++
        continue
      }
      this.expect("]")
      return result
    }
  }

  private parseString(): string {
    this.expect('"')

    // Fast path: take an escape-free run in one slice. These payloads are
    // mostly hex, so this is the difference between one copy and one per char.
    let scan = this.index
    while (scan < this.text.length && this.text[scan] !== '"' && this.text[scan] !== "\\") {
      scan++
    }
    if (this.text[scan] === '"') {
      const value = this.text.slice(this.index, scan)
      this.index = scan + 1
      return value
    }

    let result = this.text.slice(this.index, scan)
    this.index = scan
    for (;;) {
      const ch = this.text[this.index]
      if (ch === undefined) {
        throw new SyntaxError("Unterminated string in lossless JSON")
      }
      if (ch === '"') {
        this.index++
        return result
      }
      if (ch === "\\") {
        this.index++
        const escape = this.text[this.index]
        if (escape === undefined) {
          throw new SyntaxError("Unterminated escape in lossless JSON")
        }
        if (escape === "u") {
          const hex = this.text.slice(this.index + 1, this.index + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new SyntaxError(`Invalid unicode escape at position ${this.index} in lossless JSON`)
          }
          result += String.fromCharCode(parseInt(hex, 16))
          this.index += 5
          continue
        }
        const mapped = ESCAPES[escape]
        if (mapped === undefined) {
          throw new SyntaxError(`Invalid escape '\\${escape}' in lossless JSON`)
        }
        result += mapped
        this.index++
        continue
      }
      result += ch
      this.index++
    }
  }

  private parseNumber(): number | bigint {
    const start = this.index
    if (this.text[this.index] === "-") this.index++
    while (isDigit(this.text[this.index])) this.index++
    const integerEnd = this.index

    let isInteger = true
    if (this.text[this.index] === ".") {
      isInteger = false
      this.index++
      while (isDigit(this.text[this.index])) this.index++
    }
    if (this.text[this.index] === "e" || this.text[this.index] === "E") {
      isInteger = false
      this.index++
      if (this.text[this.index] === "+" || this.text[this.index] === "-") this.index++
      while (isDigit(this.text[this.index])) this.index++
    }

    const literal = this.text.slice(start, this.index)
    if (literal === "" || literal === "-") {
      throw new SyntaxError(`Invalid number at position ${start} in lossless JSON`)
    }
    if (!isInteger) return Number(literal)

    // Small integers stay numbers so existing schemas are unaffected.
    const value = BigInt(this.text.slice(start, integerEnd))
    return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value
  }
}

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** Parse JSON, decoding integers outside the safe-integer range as bigint. */
export const parse = (text: string): unknown => new Parser(text).parse()

/**
 * Serialize plain JSON values, writing a bigint as a bare numeric literal.
 * `undefined` object entries are dropped and `undefined` array entries become
 * `null`, as in `JSON.stringify`; `toJSON` is not consulted.
 */
export const stringify = (value: unknown): string => {
  const write = (input: unknown): string | undefined => {
    if (typeof input === "bigint") return input.toString()
    if (input === null) return "null"
    switch (typeof input) {
      case "string":
        return JSON.stringify(input)
      case "boolean":
        return input ? "true" : "false"
      case "number":
        return Number.isFinite(input) ? String(input) : "null"
      case "undefined":
      case "function":
      case "symbol":
        return undefined
    }
    if (Array.isArray(input)) {
      return `[${input.map((entry) => write(entry) ?? "null").join(",")}]`
    }
    const entries: Array<string> = []
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      const encoded = write(entry)
      if (encoded !== undefined) {
        entries.push(`${JSON.stringify(key)}:${encoded}`)
      }
    }
    return `{${entries.join(",")}}`
  }

  const result = write(value)
  if (result === undefined) {
    throw new TypeError("Value cannot be serialized to lossless JSON")
  }
  return result
}

/** A uint64 amount as `parse` emits it: bigint past the safe range, number below it. */
export const AmountSchema = Schema.transform(Schema.Union(Schema.BigIntFromSelf, Schema.Int), Schema.BigIntFromSelf, {
  strict: true,
  decode: (value) => (typeof value === "bigint" ? value : BigInt(value)),
  encode: (value) => value
})
