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

/** Personal access tokens (CLI / agents). Only a SHA-256 of the secret is stored. */
export interface ApiTokensTable {
  id: string
  name: string
  token_hash: string
  /** First characters of the token, shown so users can tell tokens apart. */
  prefix: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

/** Pending browser authorizations started by `sa login` (device flow). */
export interface CliAuthRequestsTable {
  device_code_hash: string
  user_code: string
  name: string
  status: string
  /** The issued token, held only until the CLI picks it up. */
  token: string | null
  created_at: number
  expires_at: number
}

/** OAuth clients, registered dynamically by MCP clients (RFC 7591). */
export interface OAuthClientsTable {
  id: string
  /** SHA-256 of the client secret; null for public clients (PKCE only). */
  secret_hash: string | null
  name: string
  /** JSON array of exact redirect URIs. */
  redirect_uris: string
  client_uri: string | null
  created_at: number
}

/** Single-use authorization codes (PKCE S256), valid for a few minutes. */
export interface OAuthCodesTable {
  code_hash: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  resource: string | null
  expires_at: number
}

/** One row per approved client. Refreshing rotates both tokens in place. */
export interface OAuthGrantsTable {
  id: string
  client_id: string
  access_hash: string
  access_expires_at: number
  refresh_hash: string
  refresh_expires_at: number
  created_at: number
  last_used_at: number | null
}

export interface Database {
  apps: AppsTable
  api_tokens: ApiTokensTable
  cli_auth_requests: CliAuthRequestsTable
  oauth_clients: OAuthClientsTable
  oauth_codes: OAuthCodesTable
  oauth_grants: OAuthGrantsTable
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
