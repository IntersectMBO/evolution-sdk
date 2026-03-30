import { randomUUID } from "node:crypto"

export type ClientHandle = string
export type BuilderHandle = string
export type ResultHandle = string
export type SubmitHandle = string
export type ClusterHandle = string

export interface ClientSession {
  readonly kind: "client"
  readonly client: unknown
  readonly capabilities: Record<string, unknown>
  readonly createdAt: string
}

export interface BuilderSession {
  readonly kind: "builder"
  readonly builder: unknown
  readonly clientHandle: ClientHandle
  readonly operations: Array<string>
  readonly createdAt: string
}

export interface ResultSession {
  readonly kind: "result"
  readonly result: unknown
  readonly resultType: "transaction-result" | "sign-builder"
  readonly builderHandle: BuilderHandle
  readonly createdAt: string
}

export interface SubmitSession {
  readonly kind: "submit"
  readonly submitBuilder: unknown
  readonly resultHandle: ResultHandle
  readonly createdAt: string
}

export interface ClusterSession {
  readonly kind: "cluster"
  readonly cluster: unknown
  readonly clusterName: string
  readonly createdAt: string
}

type SessionRecord = ClientSession | BuilderSession | ResultSession | SubmitSession | ClusterSession

const isRecord = <T extends SessionRecord["kind"]>(
  value: SessionRecord | undefined,
  kind: T
): value is Extract<SessionRecord, { kind: T }> => value?.kind === kind

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>()

  createClient(client: unknown, capabilities: Record<string, unknown>): ClientHandle {
    const handle = randomUUID()
    this.sessions.set(handle, {
      kind: "client",
      client,
      capabilities,
      createdAt: new Date().toISOString()
    })
    return handle
  }

  createBuilder(builder: unknown, clientHandle: ClientHandle, operations: Array<string> = []): BuilderHandle {
    const handle = randomUUID()
    this.sessions.set(handle, {
      kind: "builder",
      builder,
      clientHandle,
      operations,
      createdAt: new Date().toISOString()
    })
    return handle
  }

  createResult(
    result: unknown,
    resultType: "transaction-result" | "sign-builder",
    builderHandle: BuilderHandle
  ): ResultHandle {
    const handle = randomUUID()
    this.sessions.set(handle, {
      kind: "result",
      result,
      resultType,
      builderHandle,
      createdAt: new Date().toISOString()
    })
    return handle
  }

  createSubmit(submitBuilder: unknown, resultHandle: ResultHandle): SubmitHandle {
    const handle = randomUUID()
    this.sessions.set(handle, {
      kind: "submit",
      submitBuilder,
      resultHandle,
      createdAt: new Date().toISOString()
    })
    return handle
  }

  createCluster(cluster: unknown, clusterName: string): ClusterHandle {
    const handle = randomUUID()
    this.sessions.set(handle, {
      kind: "cluster",
      cluster,
      clusterName,
      createdAt: new Date().toISOString()
    })
    return handle
  }

  getClient(handle: ClientHandle): ClientSession {
    const record = this.sessions.get(handle)
    if (!isRecord(record, "client")) {
      throw new Error(`Unknown client handle: ${handle}`)
    }
    return record
  }

  getBuilder(handle: BuilderHandle): BuilderSession {
    const record = this.sessions.get(handle)
    if (!isRecord(record, "builder")) {
      throw new Error(`Unknown builder handle: ${handle}`)
    }
    return record
  }

  getResult(handle: ResultHandle): ResultSession {
    const record = this.sessions.get(handle)
    if (!isRecord(record, "result")) {
      throw new Error(`Unknown result handle: ${handle}`)
    }
    return record
  }

  getSubmit(handle: SubmitHandle): SubmitSession {
    const record = this.sessions.get(handle)
    if (!isRecord(record, "submit")) {
      throw new Error(`Unknown submit handle: ${handle}`)
    }
    return record
  }

  hasSubmit(handle: string): boolean {
    const record = this.sessions.get(handle)
    return record !== undefined && record.kind === "submit"
  }

  getCluster(handle: ClusterHandle): ClusterSession {
    const record = this.sessions.get(handle)
    if (!isRecord(record, "cluster")) {
      throw new Error(`Unknown cluster handle: ${handle}`)
    }
    return record
  }

  updateBuilderOperations(handle: BuilderHandle, operation: string): void {
    const record = this.getBuilder(handle)
    this.sessions.set(handle, {
      ...record,
      operations: [...record.operations, operation]
    })
  }

  delete(handle: string): boolean {
    return this.sessions.delete(handle)
  }

  stats(): Record<string, number> {
    let clients = 0
    let builders = 0
    let results = 0
    let submits = 0
    let clusters = 0

    for (const record of this.sessions.values()) {
      switch (record.kind) {
        case "client":
          clients += 1
          break
        case "builder":
          builders += 1
          break
        case "result":
          results += 1
          break
        case "submit":
          submits += 1
          break
        case "cluster":
          clusters += 1
          break
      }
    }

    return {
      clients,
      builders,
      results,
      submits,
      clusters,
      total: this.sessions.size
    }
  }
}

export const sessionStore = new SessionStore()