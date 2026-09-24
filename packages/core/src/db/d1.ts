import {
  CompiledQuery,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'
import { sqliteDialect } from './dialect.js'
import type { Database } from './schema.js'

/** The subset of Cloudflare's D1Database we rely on (structural, so tests can fake it). */
export interface D1Like {
  prepare(query: string): D1StatementLike
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  all<T = Record<string, unknown>>(): Promise<{ results?: T[]; meta?: { changes?: number; last_row_id?: number } }>
}

class D1Connection implements DatabaseConnection {
  constructor(private readonly d1: D1Like) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const params = query.parameters.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p))
    const result = await this.d1.prepare(query.sql).bind(...params).all<R>()
    const changes = result.meta?.changes
    const lastRowId = result.meta?.last_row_id
    return {
      rows: result.results ?? [],
      numAffectedRows: changes != null && changes > 0 ? BigInt(changes) : changes === 0 ? 0n : undefined,
      insertId: lastRowId != null ? BigInt(lastRowId) : undefined,
    }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('D1 does not support streaming queries')
  }
}

class D1Driver implements Driver {
  constructor(private readonly d1: D1Like) {}
  async init() {}
  async acquireConnection() {
    return new D1Connection(this.d1)
  }
  async beginTransaction(): Promise<void> {
    throw new Error('D1 does not support interactive transactions')
  }
  async commitTransaction() {}
  async rollbackTransaction() {}
  async releaseConnection() {}
  async destroy() {}
}

export class D1Dialect implements Dialect {
  constructor(private readonly d1: D1Like) {}
  createAdapter() {
    return new SqliteAdapter()
  }
  createDriver() {
    return new D1Driver(this.d1)
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler()
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db)
  }
}

export function createD1Database(d1: D1Like) {
  return { db: new Kysely<Database>({ dialect: new D1Dialect(d1) }), dialect: sqliteDialect }
}
