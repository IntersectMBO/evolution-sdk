/**
 * CIP-100 / CIP-108 / CIP-119 / CIP-136 — off-chain governance metadata documents.
 *
 * Builds the JSON-LD document an on-chain `anchor` points at, and the blake2b-256 hash the
 * anchor commits to.
 *
 * ⚠️ The hash here is taken over the document bytes **as given**. CIP-100 specifies
 * RDF-Dataset canonicalization (URDNA2015) over the JSON-LD, which needs a full JSON-LD to
 * N-Quads stack; that is not implemented, and this does not pretend otherwise. A document that
 * round-trips through a different serializer will hash differently.
 *
 * @since 0.1.0
 */

import { blake2b } from "@noble/hashes/blake2.js"
import { bytesToHex } from "@noble/hashes/utils.js"

export type HashAlgorithm = "blake2b-256"
export type ReferenceType = "GovernanceMetadata" | "Other" | "Link" | "Identity" | "RelevantArticles"

/** A `body.references[]` entry (input shape; emitted with the JSON-LD `@type` key). */
export interface Reference {
  readonly type: ReferenceType
  readonly label: string
  readonly uri: string
  readonly referenceHash?: { readonly hashDigest: string; readonly hashAlgorithm: HashAlgorithm }
}

export interface BuiltDocument {
  /** The JSON-LD document object. */
  readonly document: Record<string, unknown>
  /** Its exact serialization — host THIS unchanged; the hash is over these bytes. */
  readonly json: string
  /** blake2b-256 of `json` (hex) — the on-chain anchor `dataHash`. */
  readonly hashHex: string
}

// ── the spec @context objects, embedded verbatim (CIP-0{108,119,136}.common.jsonld) ──
const CONTEXT_108 = {
  CIP100: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
  CIP108: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0108/README.md#",
  hashAlgorithm: "CIP100:hashAlgorithm",
  body: {
    "@id": "CIP108:body",
    "@context": {
      references: {
        "@id": "CIP108:references",
        "@container": "@set",
        "@context": {
          GovernanceMetadata: "CIP100:GovernanceMetadataReference",
          Other: "CIP100:OtherReference",
          label: "CIP100:reference-label",
          uri: "CIP100:reference-uri",
          referenceHash: {
            "@id": "CIP108:referenceHash",
            "@context": { hashDigest: "CIP108:hashDigest", hashAlgorithm: "CIP100:hashAlgorithm" }
          }
        }
      },
      title: "CIP108:title",
      abstract: "CIP108:abstract",
      motivation: "CIP108:motivation",
      rationale: "CIP108:rationale"
    }
  },
  authors: {
    "@id": "CIP100:authors",
    "@container": "@set",
    "@context": {
      did: "@id",
      name: "http://xmlns.com/foaf/0.1/name",
      witness: {
        "@id": "CIP100:witness",
        "@context": {
          witnessAlgorithm: "CIP100:witnessAlgorithm",
          publicKey: "CIP100:publicKey",
          signature: "CIP100:signature"
        }
      }
    }
  }
} as const

const CONTEXT_119 = {
  CIP100: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
  CIP119: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
  hashAlgorithm: "CIP100:hashAlgorithm",
  body: {
    "@id": "CIP119:body",
    "@context": {
      references: {
        "@id": "CIP119:references",
        "@container": "@set",
        "@context": {
          GovernanceMetadata: "CIP100:GovernanceMetadataReference",
          Other: "CIP100:OtherReference",
          label: "CIP100:reference-label",
          uri: "CIP100:reference-uri"
        }
      },
      paymentAddress: "CIP119:paymentAddress",
      givenName: "CIP119:givenName",
      image: { "@id": "CIP119:image", "@context": { ImageObject: "https://schema.org/ImageObject" } },
      objectives: "CIP119:objectives",
      motivations: "CIP119:motivations",
      qualifications: "CIP119:qualifications"
    }
  }
} as const

const CONTEXT_136 = {
  "@language": "en-us",
  CIP100: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
  CIP136: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0136/README.md#",
  hashAlgorithm: "CIP100:hashAlgorithm",
  body: {
    "@id": "CIP136:body",
    "@context": {
      references: {
        "@id": "CIP100:references",
        "@container": "@set",
        "@context": {
          GovernanceMetadata: "CIP100:GovernanceMetadataReference",
          Other: "CIP100:OtherReference",
          label: "CIP100:reference-label",
          uri: "CIP100:reference-uri",
          RelevantArticles: "CIP136:RelevantArticles"
        }
      },
      summary: "CIP136:summary",
      rationaleStatement: "CIP136:rationaleStatement",
      precedentDiscussion: "CIP136:precedentDiscussion",
      counterargumentDiscussion: "CIP136:counterargumentDiscussion",
      conclusion: "CIP136:conclusion",
      internalVote: {
        "@id": "CIP136:internalVote",
        "@context": {
          constitutional: "CIP136:constitutional",
          unconstitutional: "CIP136:unconstitutional",
          abstain: "CIP136:abstain",
          didNotVote: "CIP136:didNotVote",
          againstVote: "CIP136:againstVote"
        }
      }
    }
  },
  authors: {
    "@id": "CIP100:authors",
    "@container": "@set",
    "@context": {
      did: "@id",
      name: "http://xmlns.com/foaf/0.1/name",
      witness: {
        "@id": "CIP100:witness",
        "@context": {
          witnessAlgorithm: "CIP100:witnessAlgorithm",
          publicKey: "CIP100:publicKey",
          signature: "CIP100:signature"
        }
      }
    }
  }
} as const

const b2b256hex = (bytes: Uint8Array): string => bytesToHex(blake2b(bytes, { dkLen: 32 }))

/** blake2b-256 (hex) of the exact UTF-8 bytes — the CIP-100 on-chain anchor `dataHash`. */
export const anchorHash = (json: string): string => b2b256hex(new TextEncoder().encode(json))

const emitReferences = (refs?: ReadonlyArray<Reference>) =>
  refs && refs.length > 0
    ? refs.map((r) => ({
        "@type": r.type,
        label: r.label,
        uri: r.uri,
        ...(r.referenceHash ? { referenceHash: r.referenceHash } : {})
      }))
    : undefined

const finish = (document: Record<string, unknown>): BuiltDocument => {
  const json = JSON.stringify(document)
  return { document, json, hashHex: anchorHash(json) }
}

/** Drop `undefined`-valued keys so optional fields are omitted, not emitted as null. */
const compact = <T extends Record<string, unknown>>(o: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

export interface GovernanceActionBody {
  readonly title: string
  readonly abstract: string
  readonly motivation: string
  readonly rationale: string
  readonly references?: ReadonlyArray<Reference>
}
/** CIP-108 governance-action metadata document. */
export const governanceAction = (body: GovernanceActionBody): BuiltDocument =>
  finish({
    "@context": CONTEXT_108,
    hashAlgorithm: "blake2b-256",
    authors: [],
    body: compact({
      title: body.title,
      abstract: body.abstract,
      motivation: body.motivation,
      rationale: body.rationale,
      references: emitReferences(body.references)
    })
  })

export interface DRepBody {
  readonly givenName: string
  readonly paymentAddress?: string
  readonly image?: { readonly "@type": "ImageObject"; readonly contentUrl: string; readonly sha256?: string }
  readonly objectives?: string
  readonly motivations?: string
  readonly qualifications?: string
  readonly references?: ReadonlyArray<Reference>
}
/** CIP-119 DRep metadata document (no authors — DReps don't witness per CIP-119). */
export const drep = (body: DRepBody): BuiltDocument =>
  finish({
    "@context": CONTEXT_119,
    hashAlgorithm: "blake2b-256",
    body: compact({
      givenName: body.givenName,
      paymentAddress: body.paymentAddress,
      image: body.image,
      objectives: body.objectives,
      motivations: body.motivations,
      qualifications: body.qualifications,
      references: emitReferences(body.references)
    })
  })

export interface InternalVote {
  readonly constitutional?: number
  readonly unconstitutional?: number
  readonly abstain?: number
  readonly didNotVote?: number
  readonly againstVote?: number
}
export interface CommitteeVoteBody {
  readonly summary: string
  readonly rationaleStatement: string
  readonly precedentDiscussion?: string
  readonly counterargumentDiscussion?: string
  readonly conclusion?: string
  readonly internalVote?: InternalVote
  readonly references?: ReadonlyArray<Reference>
}
/** CIP-136 constitutional-committee vote-rationale metadata document. */
export const committeeVote = (body: CommitteeVoteBody): BuiltDocument =>
  finish({
    "@context": CONTEXT_136,
    hashAlgorithm: "blake2b-256",
    authors: [],
    body: compact({
      summary: body.summary,
      rationaleStatement: body.rationaleStatement,
      precedentDiscussion: body.precedentDiscussion,
      counterargumentDiscussion: body.counterargumentDiscussion,
      conclusion: body.conclusion,
      internalVote: body.internalVote ? compact({ ...body.internalVote }) : undefined,
      references: emitReferences(body.references)
    })
  })

/** Compute the anchor `dataHash` for an already-serialized document (host these exact bytes). */
export const hashDocument = (json: string): string => anchorHash(json)
