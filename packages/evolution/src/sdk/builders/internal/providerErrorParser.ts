import type { ScriptFailure } from "../TransactionBuilder.js"

interface OgmiosValidatorError {
  readonly validator: { readonly index: number; readonly purpose: string }
  readonly error: {
    readonly code: number
    readonly message: string
    readonly data: {
      readonly validationError: string
      readonly traces: ReadonlyArray<string>
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const getRecordProperty = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const property = value[key]
  return isRecord(property) ? property : undefined
}

const getStringProperty = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const property = value[key]
  return typeof property === "string" ? property : undefined
}

const isOgmiosValidatorError = (value: unknown): value is OgmiosValidatorError => {
  if (!isRecord(value)) {
    return false
  }

  const validator = getRecordProperty(value, "validator")
  const error = getRecordProperty(value, "error")
  const errorData = getRecordProperty(error, "data")

  return validator !== undefined &&
    typeof validator["index"] === "number" &&
    typeof validator["purpose"] === "string" &&
    error !== undefined &&
    typeof error["code"] === "number" &&
    typeof error["message"] === "string" &&
    errorData !== undefined &&
    typeof errorData["validationError"] === "string" &&
    Array.isArray(errorData["traces"])
}

const getValidatorErrorData = (value: unknown): ReadonlyArray<OgmiosValidatorError> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value.every(isOgmiosValidatorError) ? value : undefined
}

export const parseProviderError = (error: unknown): Array<ScriptFailure> => {
  const failures: Array<ScriptFailure> = []

  const findErrorData = (value: unknown): ReadonlyArray<OgmiosValidatorError> | undefined => {
    const cause = getRecordProperty(value, "cause")
    if (cause !== undefined) {
      const response = getRecordProperty(cause, "response")
      const body = getRecordProperty(response, "body")
      const responseError = getRecordProperty(body, "error")
      const responseErrorData = getValidatorErrorData(responseError?.["data"])
      if (responseErrorData !== undefined) {
        return responseErrorData
      }

      const description = getStringProperty(cause, "description")
      if (description !== undefined) {
        try {
          const match = description.match(/\{.*\}/s)
          if (match !== null) {
            const parsed = JSON.parse(match[0])
            const parsedError = getRecordProperty(parsed, "error")
            const parsedData = getValidatorErrorData(parsedError?.["data"])
            if (parsedData !== undefined) {
              return parsedData
            }
          }
        } catch {
          return findErrorData(cause)
        }
      }

      return findErrorData(cause)
    }

    return undefined
  }

  const errorData = findErrorData(error)

  if (errorData === undefined) {
    return failures
  }

  for (const validatorError of errorData) {
    failures.push({
      purpose: validatorError.validator.purpose,
      index: validatorError.validator.index,
      validationError: validatorError.error.data.validationError,
      traces: validatorError.error.data.traces
    })
  }

  return failures
}
