// Types shared between the server and the dashboard. Keep this file free of
// runtime imports so the dashboard can `import type` from it.

export type SchemaMode = 'permissive' | 'strict'
export type PropertyType = 'string' | 'number' | 'boolean' | 'any'
export type DefinitionStatus = 'active' | 'archived'

export type SamplingStrategy = 'user' | 'event'

/**
 * full: keep every event. sampled: keep a share of events, decided by a hash
 * so retries get the same answer.
 *  - strategy "user": keep all events of a sampled share of users (funnels stay intact)
 *  - strategy "event": decide per event (user counts become lower bounds)
 * overrides set a different rate for specific event names (0 drops them).
 * `$error` is kept in full unless overridden.
 */
export interface SamplingConfig {
  mode: 'full' | 'sampled'
  strategy: SamplingStrategy
  /** Share of users / events to keep, 0 < rate ≤ 1. */
  rate: number
  overrides: { event: string; rate: number }[]
}

export const DEFAULT_SAMPLING: SamplingConfig = { mode: 'full', strategy: 'user', rate: 1, overrides: [] }

export interface App {
  id: string
  name: string
  writeKey: string
  schemaMode: SchemaMode
  retentionDays: number
  sampling: SamplingConfig
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

/**
 * events: count · users: unique users · per_user: events per user ·
 * sum:<prop> / avg:<prop>: numeric property (e.g. revenue, duration)
 */
export type Metric = 'events' | 'users' | 'per_user' | `sum:${string}` | `avg:${string}`
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

export interface ActiveUsers {
  /** Unique users in the trailing 24 hours / 7 days / 30 days. */
  dau: number
  wau: number
  mau: number
}

export interface FunnelStep {
  name: string
  users: number
  /** Share of users who started the funnel. */
  conversion: number
  /** Share of users from the previous step. */
  stepConversion: number
  /** Median time from the previous step, ms (null for the first step). */
  medianTimeMs: number | null
}

export interface FunnelResponse {
  range: TimeRange
  windowMs: number
  steps: FunnelStep[]
  /** Per-group results when a breakdown is requested (top groups by entrants). */
  groups: { key: string | null; steps: FunnelStep[] }[]
  /** True when the per-user scan hit its row limit and results are sampled. */
  truncated: boolean
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

export interface ErrorGroup {
  fingerprint: string
  type: string | null
  message: string | null
  events: number
  users: number
  firstSeen: number
  lastSeen: number
}

export interface ErrorsResponse {
  range: TimeRange
  totals: { events: number; users: number }
  groups: ErrorGroup[]
}

export interface ErrorDetailResponse {
  group: ErrorGroup | null
  buckets: number[]
  points: number[]
  /** Most recent occurrences, newest first. */
  samples: StoredEvent[]
  /** Where it happens most. */
  breakdown: { platform: TopResponse['rows']; appVersion: TopResponse['rows']; os: TopResponse['rows'] }
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

export interface ApiToken {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt: number | null
}

/** A client (e.g. an MCP client) the user authorized through OAuth. */
export interface OAuthGrant {
  id: string
  clientId: string
  clientName: string
  clientUri: string | null
  createdAt: number
  lastUsedAt: number | null
}

export interface IngestResponse {
  ok: true
  accepted: number
  /** Valid events dropped by the app's sampling settings (don't retry these). */
  sampled: number
  rejected: { index: number; id?: string; reason: string }[]
}

export interface ApiError {
  error: { code: string; message: string }
}
