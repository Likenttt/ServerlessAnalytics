import { sql, type Kysely } from 'kysely'
import type { DialectName } from './dialect.js'
import type { Database } from './schema.js'

// A deliberately tiny migrator. Kysely's built-in Migrator relies on schema
// introspection, which trips over D1's internal `_cf_*` tables. Every
// statement is idempotent (IF NOT EXISTS), so re-running after a partial
// failure on a non-transactional database (D1) is safe.

interface Migration {
  name: string
  statements(d: DialectName): string[]
}

const types = (d: DialectName) =>
  d === 'postgres'
    ? { bigint: 'BIGINT', json: 'JSONB', jsonDefault: `'{}'::jsonb` }
    : { bigint: 'INTEGER', json: 'TEXT', jsonDefault: `'{}'` }

export const MIGRATIONS: Migration[] = [
  {
    name: '0001_initial',
    statements(d) {
      const t = types(d)
      return [
        `CREATE TABLE IF NOT EXISTS apps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          write_key TEXT NOT NULL UNIQUE,
          schema_mode TEXT NOT NULL DEFAULT 'permissive',
          retention_days INTEGER NOT NULL DEFAULT 365,
          created_at ${t.bigint} NOT NULL,
          updated_at ${t.bigint} NOT NULL,
          deleted_at ${t.bigint}
        )`,
        `CREATE TABLE IF NOT EXISTS event_definitions (
          app_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          properties TEXT NOT NULL DEFAULT '[]',
          created_at ${t.bigint} NOT NULL,
          updated_at ${t.bigint} NOT NULL,
          PRIMARY KEY (app_id, name)
        )`,
        `CREATE TABLE IF NOT EXISTS events (
          app_id TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          ts ${t.bigint} NOT NULL,
          received_at ${t.bigint} NOT NULL,
          distinct_id TEXT NOT NULL,
          user_id TEXT,
          session_id TEXT,
          platform TEXT,
          os TEXT,
          os_version TEXT,
          browser TEXT,
          app_version TEXT,
          device TEXT,
          country TEXT,
          locale TEXT,
          properties ${t.json} NOT NULL DEFAULT ${t.jsonDefault},
          PRIMARY KEY (app_id, id)
        )`,
        `CREATE INDEX IF NOT EXISTS events_app_ts ON events (app_id, ts)`,
        `CREATE INDEX IF NOT EXISTS events_app_name_ts ON events (app_id, name, ts)`,
      ]
    },
  },
]

MIGRATIONS.push({
  name: '0002_channel_region',
  statements: () => [
    // ADD COLUMN has no IF NOT EXISTS on SQLite; migrate() tolerates "duplicate column" on re-runs.
    `ALTER TABLE events ADD COLUMN channel TEXT`,
    `ALTER TABLE events ADD COLUMN region TEXT`,
  ],
})

const isMissingTable = (error: unknown) =>
  /no such table|does not exist|42P01/i.test(String((error as { message?: string })?.message ?? error)) ||
  (error as { code?: string })?.code === '42P01'

export async function appliedMigrations(db: Kysely<Database>): Promise<string[]> {
  try {
    const rows = await db.selectFrom('sa_migrations').select('name').orderBy('name').execute()
    return rows.map((r) => r.name)
  } catch (error) {
    if (isMissingTable(error)) return []
    throw error
  }
}

export async function migrationStatus(db: Kysely<Database>) {
  const applied = await appliedMigrations(db)
  const pending = MIGRATIONS.map((m) => m.name).filter((name) => !applied.includes(name))
  return { applied, pending }
}

export async function migrate(db: Kysely<Database>, dialect: DialectName): Promise<string[]> {
  await sql
    .raw(`CREATE TABLE IF NOT EXISTS sa_migrations (name TEXT PRIMARY KEY, applied_at ${types(dialect).bigint} NOT NULL)`)
    .execute(db)
  const applied = new Set(await appliedMigrations(db))
  const ran: string[] = []
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue
    const run = async (conn: Kysely<Database>) => {
      for (const statement of migration.statements(dialect)) {
        try {
          await sql.raw(statement).execute(conn)
        } catch (error) {
          // A previous partial run on a non-transactional database (D1) may have added it already.
          if (!/duplicate column|already exists/i.test(String((error as Error)?.message))) throw error
        }
      }
      await conn
        .insertInto('sa_migrations')
        .values({ name: migration.name, applied_at: Date.now() })
        .onConflict((oc) => oc.column('name').doNothing())
        .execute()
    }
    if (dialect === 'postgres') await db.transaction().execute(run)
    else await run(db)
    ran.push(migration.name)
  }
  return ran
}
