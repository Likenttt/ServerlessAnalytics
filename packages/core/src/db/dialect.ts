import { sql, type Kysely, type RawBuilder } from 'kysely'
import { EVENT_COLUMNS, type Database, type EventRow } from './schema.js'

export type DialectName = 'sqlite' | 'postgres'

/**
 * Everything that differs between SQLite (D1) and Postgres lives here. The
 * repository builds all other queries with Kysely, which compiles them for
 * whichever dialect is active.
 */
export interface SqlDialect {
  readonly name: DialectName
  /** Integer bucket index: floor((ts + offsetMs) / intervalMs). */
  bucket(intervalMs: number, offsetMs: number): RawBuilder<number>
  /** A property value as text (NULL when missing). */
  propText(key: string): RawBuilder<string | null>
  /** A numeric property value (NULL when missing or not a number). */
  propNumber(key: string): RawBuilder<number | null>
  /** Insert rows, ignoring duplicate (app_id, id). Returns rows inserted. */
  insertEvents(db: Kysely<Database>, rows: EventRow[]): Promise<number>
  /** Parse the `properties` column as returned by the driver. */
  parseProperties(value: unknown): Record<string, unknown>
}

const safeInt = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error(`Expected an integer, got ${n}`)
  return sql.raw(String(n))
}

const cols = sql.raw(EVENT_COLUMNS.join(', '))

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export const sqliteDialect: SqlDialect = {
  name: 'sqlite',
  bucket: (interval, offset) => sql<number>`CAST((ts + ${safeInt(offset)}) / ${safeInt(interval)} AS INTEGER)`,
  propText(key) {
    const path = `$."${key}"`
    return sql<string | null>`(CASE json_type(properties, ${path})
      WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN NULL
      ELSE CAST(json_extract(properties, ${path}) AS TEXT) END)`
  },
  propNumber(key) {
    const path = `$."${key}"`
    return sql<number | null>`(CASE WHEN json_type(properties, ${path}) IN ('integer', 'real') THEN json_extract(properties, ${path}) END)`
  },
  async insertEvents(db, rows) {
    if (rows.length === 0) return 0
    // One statement and one bound parameter for the whole batch: D1 limits
    // statements to 100 bound parameters and counts every statement.
    const payload = JSON.stringify(rows.map((r) => ({ ...r, properties: JSON.stringify(r.properties) })))
    const select = sql.raw(EVENT_COLUMNS.map((c) => `json_extract(value, '$.${c}')`).join(', '))
    const result = await sql`INSERT OR IGNORE INTO events (${cols}) SELECT ${select} FROM json_each(${payload})`.execute(db)
    return Number(result.numAffectedRows ?? 0)
  },
  parseProperties: parseJsonObject,
}

const PG_RECORD_TYPES: Record<(typeof EVENT_COLUMNS)[number], string> = {
  app_id: 'text',
  id: 'text',
  name: 'text',
  ts: 'bigint',
  received_at: 'bigint',
  distinct_id: 'text',
  user_id: 'text',
  session_id: 'text',
  platform: 'text',
  os: 'text',
  os_version: 'text',
  browser: 'text',
  app_version: 'text',
  device: 'text',
  country: 'text',
  locale: 'text',
  channel: 'text',
  region: 'text',
  weight: 'float8',
  user_weight: 'float8',
  properties: 'jsonb',
}

export const postgresDialect: SqlDialect = {
  name: 'postgres',
  bucket: (interval, offset) => sql<number>`CAST(FLOOR((ts + ${safeInt(offset)})::numeric / ${safeInt(interval)}) AS BIGINT)`,
  propText: (key) => sql<string | null>`(properties ->> ${key})`,
  propNumber: (key) =>
    sql<number | null>`(CASE WHEN jsonb_typeof(properties -> ${key}) = 'number' THEN (properties ->> ${key})::float8 END)`,
  async insertEvents(db, rows) {
    if (rows.length === 0) return 0
    const recordType = sql.raw(EVENT_COLUMNS.map((c) => `${c} ${PG_RECORD_TYPES[c]}`).join(', '))
    const result = await sql`INSERT INTO events (${cols})
      SELECT ${cols} FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(${recordType})
      ON CONFLICT DO NOTHING`.execute(db)
    return Number(result.numAffectedRows ?? 0)
  },
  parseProperties: parseJsonObject,
}
