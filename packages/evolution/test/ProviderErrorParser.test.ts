/**
 * The evaluation phase mines Ogmios validator failures out of whatever the
 * provider threw, by reaching into the error by field name. That couples it to
 * the HTTP layer's error shape, so it is worth pinning down here rather than
 * only in the devnet suite.
 */
import { describe, expect, it } from "vitest"

import { parseProviderError } from "../src/sdk/builders/internal/providerErrorParser.js"
import { HttpResponseError } from "../src/sdk/provider/internal/HttpUtils.js"

const ogmiosBody = {
  error: {
    data: [
      {
        validator: { index: 0, purpose: "withdraw" },
        error: {
          code: 3011,
          message: "script execution failed",
          data: {
            validationError: "The machine terminated because of an error",
            traces: ["stake validator", "expected owner signature"]
          }
        }
      }
    ]
  }
}

describe("parseProviderError", () => {
  it("extracts validator failures from an HttpResponseError cause", () => {
    const failures = parseProviderError({
      cause: new HttpResponseError({
        method: "POST",
        url: "http://localhost:1337",
        status: 400,
        message: `non 2xx status code : ${JSON.stringify(ogmiosBody)}`
      })
    })

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      purpose: "withdraw",
      index: 0,
      validationError: "The machine terminated because of an error",
      traces: ["stake validator", "expected owner signature"]
    })
  })

  it("still reads the legacy `description` field", () => {
    const failures = parseProviderError({
      cause: { description: `non 2xx status code : ${JSON.stringify(ogmiosBody)}` }
    })

    expect(failures).toHaveLength(1)
    expect(failures[0]?.purpose).toBe("withdraw")
  })

  it("returns no failures when the error carries no validator data", () => {
    expect(parseProviderError({ cause: { message: "non 2xx status code : upstream unavailable" } })).toEqual([])
    expect(parseProviderError(new Error("boom"))).toEqual([])
    expect(parseProviderError(undefined)).toEqual([])
  })
})
