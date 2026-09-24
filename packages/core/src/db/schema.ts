import type { Generated } from 'kysely'

export interface AppsTable {
  id: string
  name: string
  write_key: string
  schema_mode: string
  retention_days: number
  /** JSON SamplingConfig */
  sampling: string
  created_at: number
  updated_at: number
  /** Soft delete: events are purged by the retention job, then the row. */
  deleted_at: number | null
}

export interface EventDefinitionsTable {
  app_id: string
  name: string
  description: string
  status: string
  /** JSON-encoded PropertyDefinition[] */
  properties: string
  created_at: number
  updated_at: number
}

export interface EventsTable {
  app_id: string
  id: string
  name: string
  /** Event time, epoch milliseconds (clock-skew corrected). */
  ts: number
  received_at: number
  distinct_id: string
  user_id: string | null
  session_id: string | null
  platform: string | null
  os: string | null
  os_version: string | null
  browser: string | null
  app_version: string | null
  device: string | null
  country: string | null
  locale: string | null
  /** Acquisition / distribution channel, e.g. appstore, googleplay, huawei, utm source. */
  channel: string | null
  /** Subdivision of the country (ISO 3166-2 suffix, e.g. CA, 44). */
  region: string | null
  /** Estimated events this row stands for (1 / sampling rate). */
  weight: number
  /** Estimated users per sampled user (1 / rate under user sampling, else 1). */
  user_weight: number
  /** TEXT (JSON) on SQLite, JSONB on Postgres. */
  properties: unknown
}

export interface MigrationsTable {
  name: string
  applied_at: Generated<number>
}

export interface Database {
  apps: AppsTable
  event_definitions: EventDefinitionsTable
  events: EventsTable
  sa_migrations: MigrationsTable
}

/** A fully enriched event, ready to be written. This is also the queue payload. */
export interface EventRow {
  app_id: string
  id: string
  name: string
  ts: number
  received_at: number
  distinct_id: string
  user_id: string | null
  session_id: string | null
  platform: string | null
  os: string | null
  os_version: string | null
  browser: string | null
  app_version: string | null
  device: string | null
  country: string | null
  locale: string | null
  /** Acquisition / distribution channel, e.g. appstore, googleplay, huawei, utm source. */
  channel: string | null
  /** Subdivision of the country (ISO 3166-2 suffix, e.g. CA, 44). */
  region: string | null
  weight: number
  user_weight: number
  properties: Record<string, unknown>
}

export const EVENT_COLUMNS = [
  'app_id',
  'id',
  'name',
  'ts',
  'received_at',
  'distinct_id',
  'user_id',
  'session_id',
  'platform',
  'os',
  'os_version',
  'browser',
  'app_version',
  'device',
  'country',
  'locale',
  'channel',
  'region',
  'weight',
  'user_weight',
  'properties',
] as const satisfies readonly (keyof EventRow)[]
