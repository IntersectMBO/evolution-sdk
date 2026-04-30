import { FastCheck, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as NativeScripts from "./NativeScripts.js"
import * as PlutusV1 from "./PlutusV1.js"
import * as PlutusV2 from "./PlutusV2.js"
import * as PlutusV3 from "./PlutusV3.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Script union type following Conway CDDL specification.
 *
 * CDDL:
 * ```
 * script =
 *   [ 0, native_script ]
 * / [ 1, plutus_v1_script ]
 * / [ 2, plutus_v2_script ]
 * / [ 3, plutus_v3_script ]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export const Script = Schema.Union(
  NativeScripts.NativeScript,
  PlutusV1.PlutusV1,
  PlutusV2.PlutusV2,
  PlutusV3.PlutusV3
).annotations({
  identifier: "Script",
  description: "Script union (native | plutus_v1 | plutus_v2 | plutus_v3)"
})

export type Script = typeof Script.Type

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Script): void => {
  switch (v._tag) {
    case "NativeScript":
      w.writeArrayHeader(2)
      w.writeSmallUint(0)
      NativeScripts.write(w, v)
      w.writeArrayBreak()
      break
    case "PlutusV1":
      w.writeArrayHeader(2)
      w.writeSmallUint(1)
      w.writeBytes(v.bytes)
      w.writeArrayBreak()
      break
    case "PlutusV2":
      w.writeArrayHeader(2)
      w.writeSmallUint(2)
      w.writeBytes(v.bytes)
      w.writeArrayBreak()
      break
    case "PlutusV3":
      w.writeArrayHeader(2)
      w.writeSmallUint(3)
      w.writeBytes(v.bytes)
      w.writeArrayBreak()
      break
  }
}

export const read = (r: CborReader): Script => {
  const count = r.readArrayHeader()
  const tag = r.readSmallUint()
  let result: Script
  switch (tag) {
    case 0:
      result = NativeScripts.read(r)
      break
    case 1:
      result = new PlutusV1.PlutusV1({ bytes: r.readBytes() })
      break
    case 2:
      result = new PlutusV2.PlutusV2({ bytes: r.readBytes() })
      break
    case 3:
      result = new PlutusV3.PlutusV3({ bytes: r.readBytes() })
      break
    default:
      throw new Error(`Unknown script tag: ${tag}`)
  }
  if (count === -1) r.isBreak()
  return result
}

export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Script),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBOR instead"))
  }
).annotations({ identifier: "Script.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Script.FromCBORHex" })

/**
 * FastCheck arbitrary for Script.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<Script> = FastCheck.oneof(
  // Robust native script generator (bounded depth and sizes)
  NativeScripts.arbitrary,
  PlutusV1.arbitrary,
  PlutusV2.arbitrary,
  PlutusV3.arbitrary
)

export const fromCBOR = Schema.decodeSync(FromCBORBytes)

export const fromCBORHex = Schema.decodeSync(FromCBORHex)

export const toCBOR = (data: Script, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finish()
}

export const toCBORHex = (data: Script, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBOR(data, profile))
