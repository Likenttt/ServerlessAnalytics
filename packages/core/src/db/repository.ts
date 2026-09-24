import { sql, type Kysely, type RawBuilder, type SelectQueryBuilder } from 'kysely'
import type {
  App,
  AppWithStats,
  DefinitionStatus,
  EventDefinition,
  GroupBy,
  InsightsResponse,
  Metric,
  OverviewResponse,
  PropertyDefinition,
  SchemaMode,
  StoredEvent,
  TimeRange,
  TopResponse,
} from '../types.js'
import { DAY, INTERVAL_MS, bucketOf, newAppId, newWriteKey, rangeBuckets, trailingRange } from '../util.js'
import type { SqlDialect } from './dialect.js'
import type { AppsTable, Database, EventDefinitionsTable, EventRow, EventsTable } from './schema.js'

export interface Filter {
  by: GroupBy
  value: string
}

export interface InsightsQuery {
  range: TimeRange
  event: string | null
  metric: Metric
  groupBy: GroupBy | null
  filters: Filter[]
  limit: number
}

type EventsQuery = SelectQueryBuilder<Database, 'events', object>

const toApp = (r: AppsTable): App => ({
  id: r.id,
  name: r.name,
  writeKey: r.write_key,
  schemaMode: r.schema_mode as SchemaMode,
  retentionDays: Number(r.retention_days),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
})

const toDefinition = (r: EventDefinitionsTable): EventDefinition => {
  let properties: PropertyDefinition[] = []
  try {
    properties = JSON.parse(r.properties)
  } catch {}
  return {
    appId: r.app_id,
    name: r.name,
    description: r.description,
    status: r.status as DefinitionStatus,
    properties,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

export class Repository {
  constructor(
    readonly db: Kysely<Database>,
    readonly dialect: SqlDialect,
  ) {}

  // Apps ----------------------------------------------------------------------

  async listApps(opts: { includeDeleted?: boolean } = {}): Promise<(App & { deletedAt: number | null })[]> {
    let q = this.db.selectFrom('apps').selectAll()
    if (!opts.includeDeleted) q = q.where('deleted_at', 'is', null)
    const rows = await q.orderBy('created_at', 'asc').execute()
    return rows.map((r) => ({ ...toApp(r), deletedAt: r.deleted_at == null ? null : Number(r.deleted_at) }))
  }

  async listAppsWithStats(now: number, tzOffset: number): Promise<AppWithStats[]> {
    const apps = await this.listApps()
    if (apps.length === 0) return []
    const range = trailingRange(now, 7, 'day', tzOffset)
    const off = tzOffset * 60_000
    const [daily, recent] = await Promise.all([
      this.db
        .selectFrom('events')
        .select([
          'app_id',
          this.dialect.bucket(DAY, off).as('b'),
          sql<number>`COUNT(*)`.as('n'),
        ])
        .where('ts', '>=', range.from)
        .where('ts', '<', range.to)
        .groupBy([sql`1`, sql`2`])
        .execute(),
      this.db
        .selectFrom('events')
        .select(['app_id', sql<number>`COUNT(*)`.as('n')])
        .where('ts', '>=', now - DAY)
        .groupBy('app_id')
        .execute(),
    ])
    const first = bucketOf(range.from, DAY, off)
    return apps.map(({ deletedAt: _, ...app }) => {
      const sparkline = new Array<number>(7).fill(0)
      for (const row of daily) {
        if (row.app_id !== app.id) continue
        const i = Number(row.b) - first
        if (i >= 0 && i < 7) sparkline[i] = Number(row.n)
      }
      return { ...app, sparkline, events24h: Number(recent.find((r) => r.app_id === app.id)?.n ?? 0) }
    })
  }

  async getApp(id: string): Promise<App | null> {
    const row = await this.db.selectFrom('apps').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()
    return row ? toApp(row) : null
  }

  async getAppByWriteKey(writeKey: string): Promise<App | null> {
    const row = await this.db
      .selectFrom('apps')
      .selectAll()
      .where('write_key', '=', writeKey)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    return row ? toApp(row) : null
  }

  async createApp(input: { name: string; schemaMode?: SchemaMode; retentionDays?: number }): Promise<App> {
    const now = Date.now()
    const row: AppsTable = {
      id: newAppId(),
      name: input.name,
      write_key: newWriteKey(),
      schema_mode: input.schemaMode ?? 'permissive',
      retention_days: input.retentionDays ?? 365,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    await this.db.insertInto('apps').values(row).execute()
    return toApp(row)
  }

  async updateApp(id: string, patch: { name?: string; schemaMode?: SchemaMode; retentionDays?: number }): Promise<App | null> {
    const values: Partial<AppsTable> = { updated_at: Date.now() }
    if (patch.name !== undefined) values.name = patch.name
    if (patch.schemaMode !== undefined) values.schema_mode = patch.schemaMode
    if (patch.retentionDays !== undefined) values.retention_days = patch.retentionDays
    await this.db.updateTable('apps').set(values).where('id', '=', id).execute()
    return this.getApp(id)
  }

  async rotateWriteKey(id: string): Promise<App | null> {
    await this.db.updateTable('apps').set({ write_key: newWriteKey(), updated_at: Date.now() }).where('id', '=', id).execute()
    return this.getApp(id)
  }

  /** Hides the app immediately; runRetention() purges its events and then the row. */
  async markAppDeleted(id: string): Promise<void> {
    await this.db.updateTable('apps').set({ deleted_at: Date.now() }).where('id', '=', id).execute()
  }

  async hardDeleteApp(id: string): Promise<void> {
    await this.db.deleteFrom('event_definitions').where('app_id', '=', id).execute()
    await this.db.deleteFrom('apps').where('id', '=', id).execute()
  }

  // Event definitions ---------------------------------------------------------

  async listDefinitions(appId: string): Promise<EventDefinition[]> {
    const rows = await this.db.selectFrom('event_definitions').selectAll().where('app_id', '=', appId).orderBy('name').execute()
    return rows.map(toDefinition)
  }

  async getDefinition(appId: string, name: string): Promise<EventDefinition | null> {
    const row = await this.db
      .selectFrom('event_definitions')
      .selectAll()
      .where('app_id', '=', appId)
      .where('name', '=', name)
      .executeTakeFirst()
    return row ? toDefinition(row) : null
  }

  async createDefinition(
    def: Pick<EventDefinition, 'appId' | 'name' | 'description' | 'status' | 'properties'>,
  ): Promise<EventDefinition> {
    const now = Date.now()
    const row: EventDefinitionsTable = {
      app_id: def.appId,
      name: def.name,
      description: def.description,
      status: def.status,
      properties: JSON.stringify(def.properties),
      created_at: now,
      updated_at: now,
    }
    await this.db.insertInto('event_definitions').values(row).execute()
    return toDefinition(row)
  }

  async updateDefinition(
    appId: string,
    name: string,
    patch: Partial<Pick<EventDefinition, 'description' | 'status' | 'properties'>>,
  ): Promise<EventDefinition | null> {
    const values: Partial<EventDefinitionsTable> = { updated_at: Date.now() }
    if (patch.description !== undefined) values.description = patch.description
    if (patch.status !== undefined) values.status = patch.status
    if (patch.properties !== undefined) values.properties = JSON.stringify(patch.properties)
    await this.db.updateTable('event_definitions').set(values).where('app_id', '=', appId).where('name', '=', name).execute()
    return this.getDefinition(appId, name)
  }

  async deleteDefinition(appId: string, name: string): Promise<void> {
    await this.db.deleteFrom('event_definitions').where('app_id', '=', appId).where('name', '=', name).execute()
  }

  /** Per-name volume since `since`, used to show definitions next to real traffic. */
  async eventNameStats(appId: string, since: number) {
    const rows = await this.db
      .selectFrom('events')
      .select(['name', sql<number>`COUNT(*)`.as('n'), sql<number>`MAX(ts)`.as('last')])
      .where('app_id', '=', appId)
      .where('ts', '>=', since)
      .groupBy('name')
      .execute()
    return rows.map((r) => ({ name: r.name, events: Number(r.n), lastSeen: Number(r.last) }))
  }

  // Events --------------------------------------------------------------------

  insertEvents(rows: EventRow[]): Promise<number> {
    return this.dialect.insertEvents(this.db, rows)
  }

  async recentEvents(appId: string, opts: { limit: number; before?: number; name?: string }): Promise<StoredEvent[]> {
    let q = this.db.selectFrom('events').selectAll().where('app_id', '=', appId)
    if (opts.name) q = q.where('name', '=', opts.name)
    if (opts.before) q = q.where('ts', '<', opts.before)
    const rows = await q.orderBy('ts', 'desc').limit(opts.limit).execute()
    return rows.map((r) => this.toStoredEvent(r))
  }

  /** Property keys seen in a sample of recent events. */
  async propertyKeys(appId: string, event: string | null, sample = 500): Promise<string[]> {
    let q = this.db.selectFrom('events').select('properties').where('app_id', '=', appId)
    if (event) q = q.where('name', '=', event)
    const rows = await q.orderBy('ts', 'desc').limit(sample).execute()
    const counts = new Map<string, number>()
    for (const row of rows) {
      for (const key of Object.keys(this.dialect.parseProperties(row.properties))) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key)
  }

  /** Deletes up to `limit` events older than `before`. Returns rows deleted. */
  async deleteEventsBefore(appId: string, before: number, limit: number): Promise<number> {
    const result = await this.db
      .deleteFrom('events')
      .where('app_id', '=', appId)
      .where('id', 'in', (eb) =>
        eb.selectFrom('events').select('id').where('app_id', '=', appId).where('ts', '<', before).limit(limit),
      )
      .executeTakeFirst()
    return Number(result.numDeletedRows ?? 0)
  }

  // Analytics -----------------------------------------------------------------

  private groupExpr(by: GroupBy): RawBuilder<string | null> {
    if (by.startsWith('prop:')) return this.dialect.propText(by.slice(5))
    return sql.ref<string | null>(by)
  }

  private metricExpr(metric: Metric): RawBuilder<number> {
    return metric === 'users' ? sql<number>`COUNT(DISTINCT distinct_id)` : sql<number>`COUNT(*)`
  }

  private scoped(appId: string, from: number, to: number, event: string | null, filters: Filter[]): EventsQuery {
    let q = this.db.selectFrom('events').where('app_id', '=', appId).where('ts', '>=', from).where('ts', '<', to)
    if (event) q = q.where('name', '=', event)
    for (const f of filters) q = q.where(this.groupExpr(f.by), '=', f.value)
    return q
  }

  async overview(appId: string, range: TimeRange, filters: Filter[] = []): Promise<OverviewResponse> {
    const iv = INTERVAL_MS[range.interval]
    const off = range.tzOffset * 60_000
    const span = range.to - range.from
    const totals = (from: number, to: number) =>
      this.scoped(appId, from, to, null, filters)
        .select([sql<number>`COUNT(*)`.as('events'), sql<number>`COUNT(DISTINCT distinct_id)`.as('users')])
        .executeTakeFirst()
    const [series, current, previous] = await Promise.all([
      this.scoped(appId, range.from, range.to, null, filters)
        .select([
          this.dialect.bucket(iv, off).as('b'),
          sql<number>`COUNT(*)`.as('events'),
          sql<number>`COUNT(DISTINCT distinct_id)`.as('users'),
        ])
        .groupBy(sql`1`)
        .execute(),
      totals(range.from, range.to),
      totals(range.from - span, range.from),
    ])
    const buckets = rangeBuckets(range)
    const first = bucketOf(range.from, iv, off)
    const events = new Array<number>(buckets.length).fill(0)
    const users = new Array<number>(buckets.length).fill(0)
    for (const row of series) {
      const i = Number(row.b) - first
      if (i < 0 || i >= buckets.length) continue
      events[i] = Number(row.events)
      users[i] = Number(row.users)
    }
    return {
      range,
      buckets,
      events,
      users,
      totals: { events: Number(current?.events ?? 0), users: Number(current?.users ?? 0) },
      previous: { events: Number(previous?.events ?? 0), users: Number(previous?.users ?? 0) },
    }
  }

  async top(appId: string, range: TimeRange, groupBy: GroupBy, limit: number, filters: Filter[] = []): Promise<TopResponse> {
    const rows = await this.scoped(appId, range.from, range.to, null, filters)
      .select([
        this.groupExpr(groupBy).as('value'),
        sql<number>`COUNT(*)`.as('events'),
        sql<number>`COUNT(DISTINCT distinct_id)`.as('users'),
      ])
      .groupBy(sql`1`)
      .orderBy(sql`2`, 'desc')
      .limit(limit)
      .execute()
    return {
      groupBy,
      rows: rows.map((r) => ({ value: r.value == null ? null : String(r.value), events: Number(r.events), users: Number(r.users) })),
    }
  }

  async insights(appId: string, q: InsightsQuery): Promise<InsightsResponse> {
    const { range } = q
    const iv = INTERVAL_MS[range.interval]
    const off = range.tzOffset * 60_000
    const buckets = rangeBuckets(range)
    const first = bucketOf(range.from, iv, off)
    const base = () => this.scoped(appId, range.from, range.to, q.event, q.filters)
    const metric = this.metricExpr(q.metric)

    const fill = (rows: { b: number; v: number }[]) => {
      const points = new Array<number>(buckets.length).fill(0)
      for (const row of rows) {
        const i = Number(row.b) - first
        if (i >= 0 && i < buckets.length) points[i] = Number(row.v)
      }
      return points
    }

    if (!q.groupBy) {
      const [rows, total] = await Promise.all([
        base()
          .select([this.dialect.bucket(iv, off).as('b'), metric.as('v')])
          .groupBy(sql`1`)
          .execute(),
        base().select(metric.as('v')).executeTakeFirst(),
      ])
      return {
        range,
        metric: q.metric,
        groupBy: null,
        buckets,
        series: [{ key: q.event, total: Number(total?.v ?? 0), points: fill(rows) }],
      }
    }

    const group = this.groupExpr(q.groupBy)
    const top = await base()
      .select([group.as('k'), metric.as('v')])
      .groupBy(sql`1`)
      .orderBy(sql`2`, 'desc')
      .limit(q.limit)
      .execute()
    if (top.length === 0) return { range, metric: q.metric, groupBy: q.groupBy, buckets, series: [] }

    const keys = top.map((t) => (t.k == null ? null : String(t.k)))
    const nonNull = keys.filter((k): k is string => k !== null)
    const rows = await base()
      .select([this.dialect.bucket(iv, off).as('b'), group.as('k'), metric.as('v')])
      .where((eb) => {
        const ors = []
        if (nonNull.length > 0) ors.push(eb(group, 'in', nonNull))
        if (keys.includes(null)) ors.push(eb(group, 'is', null))
        return eb.or(ors)
      })
      .groupBy([sql`1`, sql`2`])
      .execute()

    return {
      range,
      metric: q.metric,
      groupBy: q.groupBy,
      buckets,
      series: top.map((t, i) => ({
        key: keys[i] ?? null,
        total: Number(t.v),
        points: fill(rows.filter((r) => (r.k == null ? null : String(r.k)) === keys[i])),
      })),
    }
  }

  private toStoredEvent(r: EventsTable): StoredEvent {
    return {
      id: r.id,
      name: r.name,
      timestamp: Number(r.ts),
      receivedAt: Number(r.received_at),
      distinctId: r.distinct_id,
      userId: r.user_id,
      sessionId: r.session_id,
      platform: r.platform,
      os: r.os,
      osVersion: r.os_version,
      browser: r.browser,
      appVersion: r.app_version,
      device: r.device,
      country: r.country,
      locale: r.locale,
      properties: this.dialect.parseProperties(r.properties),
    }
  }
}
