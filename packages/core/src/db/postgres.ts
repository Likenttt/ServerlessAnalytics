import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { postgresDialect } from './dialect.js'
import type { Database } from './schema.js'

// Works with any Postgres: Supabase (use the pooler connection string),
// Neon, RDS, self-hosted, or Cloudflare Hyperdrive.

const INT8 = 20
const NUMERIC = 1700

const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    // COUNT(*) and BIGINT columns come back as strings by default; our values
    // (epoch ms, counts) are all well within Number.MAX_SAFE_INTEGER.
    if (oid === INT8 || oid === NUMERIC) return (value: string) => Number(value)
    return pg.types.getTypeParser(oid, format)
  },
}

export interface PostgresOptions {
  /** Max pool size. Keep this small on serverless. */
  max?: number
}

export function createPostgresDatabase(connectionString: string, options: PostgresOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    types,
  })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, pool, dialect: postgresDialect }
}
