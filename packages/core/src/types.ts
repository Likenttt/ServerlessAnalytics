// Types shared between the server and the dashboard. Keep this file free of
// runtime imports so the dashboard can `import type` from it.

export type SchemaMode = 'permissive' | 'strict'
export type PropertyType = 'string' | 'number' | 'boolean' | 'any'
export type DefinitionStatus = 'active' | 'archived'

export interface App {
  id: string
  name: string
  writeKey: string
  schemaMode: SchemaMode
  retentionDays: number
  createdAt: number
  updatedAt: number
}

export interface AppWithStats extends App {
  events24h: number
  /** Daily event counts for the last 7 days, oldest first. */
  sparkline: number[]
}

export interface PropertyDefinition {
  name: string
  type: PropertyType
  required: boolean
  description: string
}

export interface EventDefinition {
  appId: string
  name: string
  description: string
  status: DefinitionStatus
  properties: PropertyDefinition[]
  createdAt: number
  updatedAt: number
}

export interface DefinitionsResponse {
  definitions: (EventDefinition & { events30d: number; lastSeen: number | null })[]
  /** Event names received in the last 30 days that have no definition. */
  undefinedEvents: { name: string; events30d: number; lastSeen: number }[]
}

/** Built-in columns that can be used for breakdowns and filters. */
export const DIMENSIONS = [
  'name',
  'platform',
  'channel',
  'country',
  'region',
  'os',
  'os_version',
  'browser',
  'app_version',
  'device',
  'locale',
] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** A breakdown/filter target: a built-in dimension or `prop:<key>`. */
export type GroupBy = Dimension | `prop:${string}`

export type Metric = 'events' | 'users'
export type Interval = 'hour' | 'day'

export interface TimeRange {
  from: number
  to: number
  interval: Interval
  /** Minutes east of UTC, used for bucket alignment. */
  tzOffset: number
}

export interface OverviewResponse {
  range: TimeRange
  buckets: number[]
  events: number[]
  users: number[]
  totals: { events: number; users: number }
  previous: { events: number; users: number }
}

export interface TopResponse {
  groupBy: GroupBy
  rows: { value: string | null; events: number; users: number }[]
}

export interface InsightsSeries {
  key: string | null
  total: number
  points: number[]
}

export interface InsightsResponse {
  range: TimeRange
  metric: Metric
  groupBy: GroupBy | null
  buckets: number[]
  series: InsightsSeries[]
}

export interface StoredEvent {
  id: string
  name: string
  timestamp: number
  receivedAt: number
  distinctId: string
  userId: string | null
  sessionId: string | null
  platform: string | null
  os: string | null
  osVersion: string | null
  browser: string | null
  appVersion: string | null
  device: string | null
  country: string | null
  locale: string | null
  channel: string | null
  region: string | null
  properties: Record<string, unknown>
}

export interface EventsResponse {
  events: StoredEvent[]
}

export interface SystemResponse {
  version: string
  runtime: string
  database: { driver: string; dialect: 'sqlite' | 'postgres' }
  kv: { driver: string }
  queue: { driver: string }
  migrations: { applied: string[]; pending: string[] }
}

export interface SessionResponse {
  authenticated: boolean
  configError?: string
}

export interface IngestResponse {
  ok: true
  accepted: number
  rejected: { index: number; id?: string; reason: string }[]
}

export interface ApiError {
  error: { code: string; message: string }
}
