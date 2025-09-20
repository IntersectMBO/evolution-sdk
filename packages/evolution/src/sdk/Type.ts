import type * as Effect from "effect/Effect"

// Type helper to convert Effect types to Promise types
export type EffectToPromise<T> =
  T extends Effect.Effect<infer Return, infer _Error, infer _Context>
    ? Promise<Return>
    : T extends (...args: Array<any>) => Effect.Effect<infer Return, infer _Error, infer _Context>
      ? (...args: Parameters<T>) => Promise<Return>
      : never

export type EffectToPromiseAPI<T> = {
  [K in keyof T]: EffectToPromise<T[K]>}