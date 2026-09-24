import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, migrationStatus } from '../src/db/migrations.js'
import { Repository } from '../src/db/repository.js'
import type { EventRow } from '../src/db/schema.js'
import { DAY, HOUR, trailingRange } from '../src/util.js'
import { DIALECTS } from './helpers.js'

const NOW = Date.UTC(2026, 8, 24, 12, 30)

function row(appId: string, overrides: Partial<EventRow> = {}): EventRow {
  return {
    app_id: appId,
    id: crypto.randomUUID(),
    name: 'page_view',
    ts: NOW - HOUR,
    received_at: NOW,
    distinct_id: 'u1',
    user_id: null,
    session_id: null,
    platform: 'web',
    os: 'macOS',
    os_version: '15.0',
    browser: 'Chrome',
    app_version: null,
    device: 'Desktop',
    country: 'US',
    locale: 'en-US',
    channel: null,
    region: null,
    weight: 1,
    user_weight: 1,
    properties: {},
    ...overrides,
  }
}

describe.each(DIALECTS)('Repository on %s', (_, open) => {
  let repo: Repository
  let appId: string

  beforeEach(async () => {
    const { db, dialect } = open()
    await migrate(db, dialect.name)
    repo = new Repository(db, dialect)
    appId = (await repo.createApp({ name: 'Demo' })).id
  })

  it('migrations are recorded and idempotent', async () => {
    expect((await migrationStatus(repo.db)).pending).toEqual([])
    expect(await migrate(repo.db, repo.dialect.name)).toEqual([])
  })

  it('inserts in one batch and ignores duplicate ids', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(appId, { id: `e${i}`, properties: { i, tag: `t${i % 3}` } }))
    expect(await repo.insertEvents(rows)).toBe(250)
    expect(await repo.insertEvents(rows.slice(0, 10))).toBe(0)
    const recent = await repo.recentEvents(appId, { limit: 5 })
    expect(recent).toHaveLength(5)
    expect(recent[0]!.properties).toHaveProperty('tag')
  })

  it('computes overview totals, series and previous period', async () => {
    const range = trailingRange(NOW, 7, 'day', 0)
    await repo.insertEvents([
      row(appId, { distinct_id: 'a', ts: NOW - HOUR }),
      row(appId, { distinct_id: 'a', ts: NOW - 2 * HOUR }),
      row(appId, { distinct_id: 'b', ts: NOW - 2 * DAY }),
      row(appId, { distinct_id: 'c', ts: NOW - 10 * DAY }), // previous period
      row(appId, { distinct_id: 'z', ts: NOW - 30 * DAY }), // out of both
    ])
    const o = await repo.overview(appId, range)
    expect(o.buckets).toHaveLength(7)
    expect(o.totals).toEqual({ events: 3, users: 2 })
    expect(o.previous).toEqual({ events: 1, users: 1 })
    expect(o.events.at(-1)).toBe(2)
    expect(o.events.at(-3)).toBe(1)
    expect(o.users.at(-1)).toBe(1)
  })

  it('aligns buckets to the requested timezone', async () => {
    // 23:30 UTC on Sep 23 is Sep 24 in UTC+8.
    const ts = Date.UTC(2026, 8, 23, 23, 30)
    await repo.insertEvents([row(appId, { ts })])
    const utc = await repo.overview(appId, trailingRange(NOW, 3, 'day', 0))
    const cst = await repo.overview(appId, trailingRange(NOW, 3, 'day', 480))
    expect(utc.events).toEqual([0, 1, 0])
    expect(cst.events).toEqual([0, 0, 1])
  })

  it('breaks down by property and dimension with filters', async () => {
    await repo.insertEvents([
      row(appId, { name: 'purchase', distinct_id: 'a', properties: { plan: 'pro', amount: 10, trial: true }, platform: 'ios' }),
      row(appId, { name: 'purchase', distinct_id: 'a', properties: { plan: 'pro', amount: 20, trial: false }, platform: 'ios' }),
      row(appId, { name: 'purchase', distinct_id: 'b', properties: { plan: 'free', amount: 0 }, platform: 'android' }),
      row(appId, { name: 'purchase', distinct_id: 'c', properties: {}, platform: 'web' }),
      row(appId, { name: 'signup', distinct_id: 'd' }),
    ])
    const range = trailingRange(NOW, 24, 'hour', 0)

    const byPlan = await repo.insights(appId, { range, event: 'purchase', metric: 'events', groupBy: 'prop:plan', filters: [], limit: 10 })
    expect(byPlan.series[0]!.key).toBe('pro')
    expect(Object.fromEntries(byPlan.series.map((s) => [String(s.key), s.total]))).toEqual({ pro: 2, free: 1, null: 1 })
    expect(byPlan.series.find((s) => s.key === 'pro')!.points.reduce((a, b) => a + b, 0)).toBe(2)

    const users = await repo.insights(appId, { range, event: 'purchase', metric: 'users', groupBy: 'prop:plan', filters: [], limit: 10 })
    expect(users.series.find((s) => s.key === 'pro')!.total).toBe(1)

    const booleans = await repo.top(appId, range, 'prop:trial', 10)
    expect(booleans.rows.map((r) => r.value).sort()).toEqual(['false', 'true', null].sort())

    const numbers = await repo.top(appId, range, 'prop:amount', 10)
    expect(numbers.rows.map((r) => r.value)).toContain('20')

    const filtered = await repo.insights(appId, {
      range,
      event: 'purchase',
      metric: 'events',
      groupBy: 'platform',
      filters: [{ by: 'prop:plan', value: 'pro' }],
      limit: 10,
    })
    expect(filtered.series).toEqual([expect.objectContaining({ key: 'ios', total: 2 })])

    const all = await repo.insights(appId, { range, event: null, metric: 'events', groupBy: null, filters: [], limit: 10 })
    expect(all.series[0]!.total).toBe(5)

    const names = await repo.top(appId, range, 'name', 10)
    expect(names.rows[0]).toEqual({ value: 'purchase', events: 4, users: 3 })
  })

  it('breaks down by channel and region', async () => {
    await repo.insertEvents([
      row(appId, { channel: 'appstore', country: 'US', region: 'CA', distinct_id: 'a' }),
      row(appId, { channel: 'appstore', country: 'US', region: 'NY', distinct_id: 'b' }),
      row(appId, { channel: 'huawei', country: 'CN', region: '44', distinct_id: 'c' }),
    ])
    const range = trailingRange(NOW, 24, 'hour', 0)
    expect((await repo.top(appId, range, 'channel', 10)).rows[0]).toEqual({ value: 'appstore', events: 2, users: 2 })
    const regions = await repo.top(appId, range, 'region', 10, [{ by: 'country', value: 'US' }])
    expect(regions.rows.map((r) => r.value).sort()).toEqual(['CA', 'NY'])
  })

  it('groups $error events by fingerprint', async () => {
    const err = (fp: string, user: string, ts = NOW - HOUR) =>
      row(appId, { name: '$error', distinct_id: user, ts, properties: { $fingerprint: fp, type: 'TypeError', message: `boom ${fp}` } })
    await repo.insertEvents([err('aaaa', 'u1'), err('aaaa', 'u2'), err('aaaa', 'u2', NOW - 2 * HOUR), err('bbbb', 'u3'), row(appId)])
    const range = trailingRange(NOW, 24, 'hour', 0)
    const res = await repo.errorGroups(appId, range, [], 10)
    expect(res.totals).toEqual({ events: 4, users: 3 })
    expect(res.groups[0]).toMatchObject({ fingerprint: 'aaaa', events: 3, users: 2, type: 'TypeError', message: 'boom aaaa', lastSeen: NOW - HOUR })
    const one = await repo.errorGroups(appId, range, [], 10, 'bbbb')
    expect(one.groups).toHaveLength(1)
    const samples = await repo.recentEvents(appId, { limit: 10, name: '$error', filters: [{ by: 'prop:$fingerprint', value: 'aaaa' }] })
    expect(samples).toHaveLength(3)
  })

  it('computes property metrics: sum, avg and events per user', async () => {
    await repo.insertEvents([
      row(appId, { name: 'purchase', distinct_id: 'a', properties: { amount: 10, plan: 'pro' } }),
      row(appId, { name: 'purchase', distinct_id: 'a', properties: { amount: 20.5, plan: 'pro' } }),
      row(appId, { name: 'purchase', distinct_id: 'b', properties: { amount: 'n/a', plan: 'free' } }),
    ])
    const range = trailingRange(NOW, 24, 'hour', 0)
    const q = (metric: string, groupBy: 'prop:plan' | null = null) =>
      repo.insights(appId, { range, event: 'purchase', metric: metric as never, groupBy, filters: [], limit: 10 })
    expect((await q('sum:amount')).series[0]!.total).toBeCloseTo(30.5)
    expect((await q('avg:amount')).series[0]!.total).toBeCloseTo(15.25)
    expect((await q('per_user')).series[0]!.total).toBeCloseTo(1.5)
    const byPlan = await q('sum:amount', 'prop:plan')
    expect(byPlan.series[0]).toMatchObject({ key: 'pro' })
    expect(byPlan.series[0]!.total).toBeCloseTo(30.5)
  })

  it('counts DAU / WAU / MAU', async () => {
    await repo.insertEvents([
      row(appId, { distinct_id: 'a', ts: NOW - HOUR }),
      row(appId, { distinct_id: 'b', ts: NOW - 3 * DAY }),
      row(appId, { distinct_id: 'c', ts: NOW - 20 * DAY }),
      row(appId, { distinct_id: 'd', ts: NOW - 40 * DAY }),
    ])
    expect(await repo.activeUsers(appId, NOW)).toEqual({ dau: 1, wau: 2, mau: 3 })
  })

  it('computes ordered funnels with a conversion window and breakdown', async () => {
    const at = (h: number) => NOW - 48 * HOUR + h * HOUR
    await repo.insertEvents([
      // a: view → signup → purchase (converts fully)
      row(appId, { distinct_id: 'a', name: 'view', ts: at(0), platform: 'ios' }),
      row(appId, { distinct_id: 'a', name: 'signup', ts: at(1), platform: 'ios' }),
      row(appId, { distinct_id: 'a', name: 'purchase', ts: at(3), platform: 'ios' }),
      // b: signup before view → stops at step 1
      row(appId, { distinct_id: 'b', name: 'signup', ts: at(0), platform: 'android' }),
      row(appId, { distinct_id: 'b', name: 'view', ts: at(2), platform: 'android' }),
      // c: view → signup, purchase outside a 10h window
      row(appId, { distinct_id: 'c', name: 'view', ts: at(0), platform: 'ios' }),
      row(appId, { distinct_id: 'c', name: 'signup', ts: at(2), platform: 'ios' }),
      row(appId, { distinct_id: 'c', name: 'purchase', ts: at(20), platform: 'ios' }),
    ])
    const res = await repo.funnel(appId, {
      range: trailingRange(NOW, 7, 'day', 0),
      steps: ['view', 'signup', 'purchase'],
      windowMs: 10 * HOUR,
      filters: [],
      groupBy: 'platform',
    })
    expect(res.steps.map((s) => s.users)).toEqual([3, 2, 1])
    expect(res.steps[1]!.stepConversion).toBeCloseTo(2 / 3)
    expect(res.steps[2]!.conversion).toBeCloseTo(1 / 3)
    expect(res.steps[1]!.medianTimeMs).toBe(2 * HOUR)
    expect(res.groups.find((g) => g.key === 'ios')!.steps.map((s) => s.users)).toEqual([2, 2, 1])
    expect(res.groups.find((g) => g.key === 'android')!.steps.map((s) => s.users)).toEqual([1, 0, 0])
    expect(res.truncated).toBe(false)
  })

  it('estimates full-volume counts from sampled rows', async () => {
    // 10% user sampling: each stored row stands for 10 events and each user for 10 users.
    await repo.insertEvents([
      row(appId, { distinct_id: 'a', weight: 10, user_weight: 10, properties: { amount: 2 } }),
      row(appId, { distinct_id: 'a', weight: 10, user_weight: 10, properties: { amount: 4 } }),
      row(appId, { distinct_id: 'b', weight: 10, user_weight: 10, properties: { amount: 6 } }),
    ])
    const range = trailingRange(NOW, 24, 'hour', 0)
    const o = await repo.overview(appId, range)
    expect(o.totals).toEqual({ events: 30, users: 20 })
    const q = (metric: string) => repo.insights(appId, { range, event: null, metric: metric as never, groupBy: null, filters: [], limit: 5 })
    expect((await q('sum:amount')).series[0]!.total).toBe(120)
    expect((await q('avg:amount')).series[0]!.total).toBe(4)
    expect((await q('per_user')).series[0]!.total).toBe(1.5)
    expect((await repo.top(appId, range, 'name', 5)).rows[0]).toMatchObject({ events: 30, users: 20 })
  })

  it('lists apps with a 7-day sparkline', async () => {
    await repo.insertEvents([row(appId, { ts: Date.now() - HOUR }), row(appId, { ts: Date.now() - 3 * DAY })])
    const [app] = await repo.listAppsWithStats(Date.now(), 0)
    expect(app!.events24h).toBe(1)
    expect(app!.sparkline).toHaveLength(7)
    expect(app!.sparkline.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('manages definitions and name stats', async () => {
    await repo.createDefinition({
      appId,
      name: 'signup',
      description: 'User created an account',
      status: 'active',
      properties: [{ name: 'method', type: 'string', required: true, description: '' }],
    })
    const updated = await repo.updateDefinition(appId, 'signup', { status: 'archived' })
    expect(updated).toMatchObject({ status: 'archived', description: 'User created an account' })
    expect(updated!.properties[0]!.name).toBe('method')

    await repo.insertEvents([row(appId, { name: 'signup' }), row(appId, { name: 'other' })])
    const stats = await repo.eventNameStats(appId, NOW - DAY)
    expect(stats.map((s) => s.name).sort()).toEqual(['other', 'signup'])

    await repo.deleteDefinition(appId, 'signup')
    expect(await repo.listDefinitions(appId)).toEqual([])
  })

  it('finds property keys, deletes old events and soft-deletes apps', async () => {
    await repo.insertEvents([
      row(appId, { ts: NOW - 100 * DAY, properties: { old: 1 } }),
      row(appId, { properties: { plan: 'pro', seats: 3 } }),
    ])
    expect(await repo.propertyKeys(appId, null)).toEqual(expect.arrayContaining(['plan', 'seats', 'old']))
    expect(await repo.deleteEventsBefore(appId, NOW - 90 * DAY, 100)).toBe(1)
    expect(await repo.recentEvents(appId, { limit: 10 })).toHaveLength(1)

    const app = (await repo.getApp(appId))!
    await repo.markAppDeleted(appId)
    expect(await repo.getApp(appId)).toBeNull()
    expect(await repo.getAppByWriteKey(app.writeKey)).toBeNull()
    expect(await repo.listApps()).toEqual([])
    expect(await repo.listApps({ includeDeleted: true })).toHaveLength(1)
  })
})
