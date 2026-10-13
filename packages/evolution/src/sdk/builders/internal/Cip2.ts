/**
 * CIP-2 coin selection, over a scalar projection of a value.
 *
 * A faithful port of CSL's `cip2_largest_first_by` / `cip2_random_improve_by`
 * (`cardano-serialization-lib`, `rust/src/builders/tx_builder.rs`), with one deliberate
 * difference: CSL folds a per-input fee into the running target as it selects. This core does
 * not compute per-input fees. The caller passes a target already grossed up with a fee estimate
 * and recomputes the exact fee over the chosen set afterwards. The job here is to pick a
 * *covering set* under a chosen strategy, so change distribution and privacy differ by strategy
 * the way CIP-2 intends.
 *
 * Generic over the caller's outpoint identity: selection never inspects it, only carries it
 * through to the result. `CoinSelection.ts` is the public surface over `UTxO` and `Assets`.
 *
 * @since 2.0.0
 */
import { Data } from "effect"

/**
 * A multi-asset value reduced to what selection needs: a coin and a flat asset map, keyed by
 * unit (concatenated policy id and asset name hex).
 *
 * @since 2.0.0
 * @category model
 */
export interface SelValue {
  readonly coin: bigint
  /** unit to quantity. Empty for pure-ADA values. */
  readonly assets: ReadonlyMap<string, bigint>
}

/**
 * A candidate UTxO: the caller's identity plus the value selection reasons about.
 *
 * @since 2.0.0
 * @category model
 */
export interface SelUtxo<Id> {
  readonly id: Id
  readonly value: SelValue
}

/**
 * @since 2.0.0
 * @category model
 */
export type Strategy = "largest-first" | "random-improve" | "largest-first-multiasset" | "random-improve-multiasset"

/**
 * @since 2.0.0
 * @category errors
 */
export class Cip2Error extends Data.TaggedError("Cip2Error")<{
  message: string
  cause?: unknown
}> {}

/**
 * @since 2.0.0
 * @category model
 */
export interface SelectResult<Id> {
  readonly selected: ReadonlyArray<SelUtxo<Id>>
  readonly inputTotal: SelValue
}

/**
 * @since 2.0.0
 * @category constructors
 */
export const emptyValue = (coin = 0n): SelValue => ({ coin, assets: new Map() })

/** Scalar projection: the coin, or one asset. `undefined` when the value has none of that asset. */
type By = (v: SelValue) => bigint | undefined
const byCoin: By = (v) => v.coin
const byAsset =
  (unit: string): By =>
  (v) =>
    v.assets.get(unit)

const valueAdd = (a: SelValue, b: SelValue): SelValue => {
  const assets = new Map(a.assets)
  for (const [k, q] of b.assets) assets.set(k, (assets.get(k) ?? 0n) + q)
  return { coin: a.coin + b.coin, assets }
}

/** Every unit present with a positive quantity. */
const units = (v: SelValue): Array<string> => [...v.assets.entries()].filter(([, q]) => q > 0n).map(([k]) => k)

/**
 * A source of floats in `[0, 1)`.
 *
 * @since 2.0.0
 * @category model
 */
export type Rng = () => number

/**
 * Cryptographically-random `[0, 1)`, the default source for random-improve.
 *
 * Throws when WebCrypto is absent rather than quietly degrading to a predictable PRNG, which
 * would reintroduce exactly the problem the default exists to avoid: random-improve's purpose is
 * that an observer cannot predict which UTxOs a wallet will combine. On React Native, install
 * `react-native-get-random-values` or `expo-crypto`, or pass your own `rng`.
 *
 * @since 2.0.0
 * @category constructors
 */
export const cryptoRng = (): Rng => {
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.getRandomValues !== "function") {
    throw new Cip2Error({
      message:
        "coin selection needs crypto.getRandomValues and none is available - pass your own rng, " +
        "or install a WebCrypto polyfill (React Native: react-native-get-random-values / expo-crypto). " +
        "Refusing to fall back to a predictable PRNG."
    })
  }
  const buf = new Uint32Array(1)
  return () => {
    c.getRandomValues(buf)
    return (buf[0] as number) / 4294967296
  }
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Tests and examples only: reproducibility, not
 * unpredictability. A fixed seed makes selection identical for every wallet holding the same
 * UTxO set, which is the opposite of what random-improve is for.
 *
 * @since 2.0.0
 * @category constructors
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n)

/**
 * `ctx.utxos[i]` and `relevant[k]` are in-bounds by construction: every index in those
 * collections came from `utxos.map((_, i) => i)`. Stated once here rather than as a non-null
 * assertion at each of the ~19 access sites, so `noUncheckedIndexedAccess` still catches a
 * genuinely unchecked access elsewhere.
 */
const utxoAt = <Id>(ctx: Ctx<Id>, i: number): SelUtxo<Id> => ctx.utxos[i] as SelUtxo<Id>
const idxAt = (a: ReadonlyArray<number>, k: number): number => a[k] as number

interface Ctx<Id> {
  readonly utxos: ReadonlyArray<SelUtxo<Id>>
  readonly available: Set<number>
  readonly selected: Set<number>
  readonly order: Array<number>
  inputTotal: SelValue
}

function choose<Id>(ctx: Ctx<Id>, i: number): void {
  ctx.available.delete(i)
  if (!ctx.selected.has(i)) {
    ctx.selected.add(i)
    ctx.order.push(i)
    ctx.inputTotal = valueAdd(ctx.inputTotal, utxoAt(ctx, i).value)
  }
}

/** Largest-first over one scalar dimension `by`, targeting `need`. */
function largestFirstBy<Id>(ctx: Ctx<Id>, by: By, need: bigint): void {
  const relevant = [...ctx.available].filter((i) => by(utxoAt(ctx, i).value) !== undefined)
  // ascending by the predicate, then consumed from the largest end
  relevant.sort((a, b) => cmp(by(utxoAt(ctx, a).value)!, by(utxoAt(ctx, b).value)!))
  for (let k = relevant.length - 1; k >= 0; k--) {
    if ((by(ctx.inputTotal) ?? 0n) >= need) break
    choose(ctx, idxAt(relevant, k))
  }
  if ((by(ctx.inputTotal) ?? 0n) < need) throw new Cip2Error({ message: "UTxO balance insufficient" })
}

/** Random-improve over one scalar dimension. `improve` runs phase 2, the ADA pass only, per CSL. */
function randomImproveBy<Id>(ctx: Ctx<Id>, by: By, need: bigint, rng: Rng, improve: boolean): void {
  // Phase 1: random selection until covered.
  const relevant = [...ctx.available].filter((i) => by(utxoAt(ctx, i).value) !== undefined)
  const associated: Array<number> = []
  while ((by(ctx.inputTotal) ?? 0n) < need) {
    if (relevant.length === 0) throw new Cip2Error({ message: "UTxO balance insufficient" })
    const r = randInt(rng, relevant.length)
    const i = idxAt(relevant, r)
    relevant[r] = idxAt(relevant, relevant.length - 1)
    relevant.pop()
    choose(ctx, i)
    associated.push(i)
  }
  // Phase 2: improvement. Swap a chosen input for a random remaining one when that moves the
  // per-input contribution closer to the ideal (2x need) without exceeding 3x need. CSL runs
  // this on the pure-ADA pass only.
  if (improve && relevant.length > 0 && need > 0n) {
    const ideal = 2n * need
    const max = 3n * need
    for (let idx = 0; idx < associated.length; idx++) {
      if (relevant.length === 0) break
      const r = randInt(rng, relevant.length)
      const j = idxAt(relevant, r)
      const i = idxAt(associated, idx)
      const cur = by(utxoAt(ctx, i).value) ?? 0n
      const nw = by(utxoAt(ctx, j).value) ?? 0n
      const moveCloser = absDiff(ideal, nw) < absDiff(ideal, cur)
      // The swap must not drop the selection below the target. Found by fuzzing: swapping a
      // large input for a smaller "closer to ideal" one could break coverage.
      const stillCovers = (by(ctx.inputTotal) ?? 0n) - cur + nw >= need
      if (moveCloser && nw < max && stillCovers) {
        ctx.selected.delete(i)
        ctx.available.add(i)
        relevant[r] = i
        associated[idx] = j
        rebuild(ctx, j, i)
      }
    }
  }
}

/** Swap `add` in and `remove` out of the running order and total. */
function rebuild<Id>(ctx: Ctx<Id>, add: number, remove: number): void {
  ctx.available.delete(add)
  ctx.selected.add(add)
  const pos = ctx.order.indexOf(remove)
  if (pos >= 0) ctx.order.splice(pos, 1, add)
  else ctx.order.push(add)
  ctx.inputTotal = ctx.order.reduce((acc, i) => valueAdd(acc, utxoAt(ctx, i).value), emptyValue())
}

const cmp = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0)
const absDiff = (a: bigint, b: bigint): bigint => (a > b ? a - b : b - a)

/**
 * Select a covering input set for `target` under `strategy`.
 *
 * `target.coin` should already include the fee estimate; see the module header.
 *
 * @since 2.0.0
 * @category selection
 */
export function selectCoins<Id>(
  utxos: ReadonlyArray<SelUtxo<Id>>,
  target: SelValue,
  strategy: Strategy,
  opts: { readonly seed?: number; readonly rng?: Rng } = {}
): SelectResult<Id> {
  // Built lazily so the deterministic strategies never touch (or require) an RNG: largest-first
  // must keep working on a platform with no WebCrypto.
  let rngCache: Rng | undefined
  const rng = (): Rng => (rngCache ??= opts.rng ?? (opts.seed !== undefined ? mulberry32(opts.seed) : cryptoRng()))
  const ctx: Ctx<Id> = {
    utxos,
    available: new Set(utxos.map((_, i) => i)),
    selected: new Set(),
    order: [],
    inputTotal: emptyValue()
  }
  const targetUnits = units(target)

  switch (strategy) {
    case "largest-first":
      if (targetUnits.length > 0) {
        throw new Cip2Error({ message: "multiasset target needs a *-multiasset strategy" })
      }
      largestFirstBy(ctx, byCoin, target.coin)
      break
    case "random-improve":
      if (targetUnits.length > 0) {
        throw new Cip2Error({ message: "multiasset target needs a *-multiasset strategy" })
      }
      randomImproveBy(ctx, byCoin, target.coin, rng(), true)
      break
    case "largest-first-multiasset":
      for (const unit of targetUnits) largestFirstBy(ctx, byAsset(unit), target.assets.get(unit)!)
      largestFirstBy(ctx, byCoin, target.coin)
      break
    case "random-improve-multiasset":
      for (const unit of targetUnits) randomImproveBy(ctx, byAsset(unit), target.assets.get(unit)!, rng(), false)
      randomImproveBy(ctx, byCoin, target.coin, rng(), false)
      // Phase 3: top up ADA for fees, which is not associated with any output.
      while (ctx.inputTotal.coin < target.coin) {
        if (ctx.available.size === 0) throw new Cip2Error({ message: "UTxO balance insufficient" })
        const arr = [...ctx.available]
        choose(ctx, idxAt(arr, randInt(rng(), arr.length)))
      }
      break
  }

  return { selected: ctx.order.map((i) => utxoAt(ctx, i)), inputTotal: ctx.inputTotal }
}
