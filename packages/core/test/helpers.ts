import { PGlite, types } from '@electric-sql/pglite'
import { DatabaseSync } from 'node:sqlite'
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'
import { createD1Database, type D1Like } from '../src/db/d1.js'
import { postgresDialect } from '../src/db/dialect.js'
import type { Database } from '../src/db/schema.js'
import type { OpenDatabase } from '../src/services.js'

/** A D1 binding backed by node:sqlite, mimicking D1's `prepare().bind().all()` results. */
export function fakeD1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  return {
    raw,
    prepare(query: string) {
      let params: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          params = values
          return statement
        },
        async all<T>() {
          const st = raw.prepare(query)
          if (st.columns().length > 0) {
            return { results: st.all(...(params as never[])) as T[], meta: { changes: 0 } }
          }
          const r = st.run(...(params as never[]))
          return { results: [] as T[], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
        },
      }
      return statement
    },
  }
}

class PGliteConnection implements DatabaseConnection {
  constructor(private readonly pg: PGlite) {}
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.pg.query<R>(query.sql, query.parameters as unknown[])
    return { rows: result.rows, numAffectedRows: result.affectedRows != null ? BigInt(result.affectedRows) : undefined }
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('not supported')
  }
}

class PGliteDialect implements Dialect {
  constructor(private readonly pg: PGlite) {}
  createAdapter() {
    return new PostgresAdapter()
  }
  createQueryCompiler() {
    return new PostgresQueryCompiler()
  }
  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db)
  }
  createDriver(): Driver {
    const connection = new PGliteConnection(this.pg)
    const run = (sql: string) => connection.executeQuery(CompiledQuery.raw(sql)).then(() => {})
    return {
      init: async () => {},
      acquireConnection: async () => connection,
      beginTransaction: () => run('begin'),
      commitTransaction: () => run('commit'),
      rollbackTransaction: () => run('rollback'),
      releaseConnection: async () => {},
      destroy: async () => {},
    }
  }
}

export function pgliteDatabase(): OpenDatabase {
  const pg = new PGlite({ parsers: { [types.INT8]: (v: string) => Number(v), [types.NUMERIC]: (v: string) => Number(v) } })
  return { db: new Kysely<Database>({ dialect: new PGliteDialect(pg) }), dialect: postgresDialect }
}

export function d1Database(d1 = fakeD1()): OpenDatabase {
  return createD1Database(d1)
}

export const DIALECTS = [
  ['sqlite (D1)', () => d1Database()],
  ['postgres (PGlite)', () => pgliteDatabase()],
] as const
