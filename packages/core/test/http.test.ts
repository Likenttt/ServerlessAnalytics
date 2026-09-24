import { beforeEach, describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { createApp } from '../src/app.js'
import { consumeQueueBodies, createServices } from '../src/services.js'
import type { App, IngestResponse, InsightsResponse, OverviewResponse } from '../src/types.js'
import { fakeD1, d1Database } from './helpers.js'

const PASSWORD = 'correct horse battery'

function setup(extraEnv: Record<string, unknown> = {}) {
  const d1 = fakeD1()
  const sent: unknown[] = []
  const background: Promise<unknown>[] = []
  const env: Record<string, unknown> = {
    ADMIN_PASSWORD: PASSWORD,
    DB: d1,
    EVENTS_QUEUE: { sendBatch: async (messages: { body: unknown }[]) => void sent.push(...messages.map((m) => m.body)) },
    ...extraEnv,
  }
  const database = d1Database(d1)
  const platform = () => ({
    runtime: 'test',
    env,
    waitUntil: (p: Promise<unknown>) => void background.push(p),
    openDatabase: () => database,
  })
  const app = createApp({ services: () => createServices(platform()), env: () => env })

  let cookie = ''
  const request = async (path: string, init: RequestInit & { json?: unknown; base?: string } = {}) => {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('cookie', cookie)
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      init.body = JSON.stringify(init.json)
    }
    const res = await app.request(`${init.base ?? 'https://analytics.test'}${path}`, { ...init, headers })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]!
    return res
  }
  const settle = async () => {
    while (background.length) await Promise.all(background.splice(0))
  }
  return {
    request,
    settle,
    sent,
    services: () => createServices(platform()),
  }
}

async function bootstrap(t: ReturnType<typeof setup>) {
  expect((await t.request('/api/auth/login', { method: 'POST', json: { password: PASSWORD } })).status).toBe(200)
  expect((await t.request('/api/system/migrate', { method: 'POST' })).status).toBe(200)
  const res = await t.request('/api/apps', { method: 'POST', json: { name: 'My App' } })
  expect(res.status).toBe(201)
  return ((await res.json()) as { app: App }).app
}

describe('HTTP API', () => {
  let t: ReturnType<typeof setup>

  beforeEach(() => {
    t = setup()
  })

  it('reports configuration errors on the session endpoint', async () => {
    const broken = setup({ ADMIN_PASSWORD: undefined })
    const body = await (await broken.request('/api/auth/session')).json()
    expect(body).toMatchObject({ authenticated: false, configError: expect.stringContaining('ADMIN_PASSWORD') })
  })

  it('requires a session for the dashboard API', async () => {
    expect((await t.request('/api/apps')).status).toBe(401)
    expect((await t.request('/api/auth/login', { method: 'POST', json: { password: 'nope' } })).status).toBe(401)
    await bootstrap(t)
    expect((await t.request('/api/apps')).status).toBe(200)
    expect(await (await t.request('/api/auth/session')).json()).toEqual({ authenticated: true })
  })

  it('accepts ADMIN_API_TOKEN as a Bearer token', async () => {
    const token = 'tok_' + 'x'.repeat(30)
    const api = setup({ ADMIN_API_TOKEN: token })
    await bootstrap(api)
    const fresh = setup({ ADMIN_API_TOKEN: token })
    expect((await fresh.request('/api/apps')).status).toBe(401)
    expect((await fresh.request('/api/apps', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
    expect((await fresh.request('/api/system', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
    await expect(setup({ ADMIN_API_TOKEN: 'short' }).request('/api/auth/session').then((r) => r.json())).resolves.toMatchObject({
      configError: expect.stringContaining('ADMIN_API_TOKEN'),
    })
  })

  it('issues, uses and revokes personal access tokens', async () => {
    await bootstrap(t)
    const created = (await (await t.request('/api/tokens', { method: 'POST', json: { name: 'laptop' } })).json()) as {
      token: { id: string; name: string; prefix: string }
      secret: string
    }
    expect(created.secret).toMatch(/^sa_pat_[A-Za-z0-9]{40}$/)
    expect(created.token).toMatchObject({ name: 'laptop', prefix: created.secret.slice(0, 11) })

    const bearer = { headers: { authorization: `Bearer ${created.secret}` }, base: 'https://other.test' }
    const current = await (await t.request('/api/tokens/current', bearer)).json()
    expect(current).toMatchObject({ token: { id: created.token.id, name: 'laptop' } })
    // Bearer requests skip the Origin check: they carry no cookie.
    expect((await t.request('/api/apps', { ...bearer, method: 'POST', json: { name: 'via token' }, headers: { ...bearer.headers, origin: 'https://evil.test' } })).status).toBe(201)

    const list = (await (await t.request('/api/tokens')).json()) as { tokens: { id: string; lastUsedAt: number | null }[] }
    expect(list.tokens.map((x) => x.id)).toEqual([created.token.id])
    expect(JSON.stringify(list)).not.toContain(created.secret)

    expect((await t.request(`/api/tokens/${created.token.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await t.request('/api/apps', bearer)).status).toBe(401)
    expect((await t.request('/api/apps', { headers: { authorization: 'Bearer sa_pat_made-up' } })).status).toBe(401)
  })

  it('rejects cross-origin mutations', async () => {
    await bootstrap(t)
    const res = await t.request('/api/apps', { method: 'POST', json: { name: 'x' }, headers: { origin: 'https://evil.test' } })
    expect(res.status).toBe(403)
  })

  it('accepts same-origin mutations behind a TLS-terminating proxy', async () => {
    // Vercel's Node runtime sees http:// URLs; the browser's Origin is https://.
    const proxied = { base: 'http://analytics.test', headers: { 'x-forwarded-proto': 'https', origin: 'https://analytics.test' } }
    const login = await t.request('/api/auth/login', { method: 'POST', json: { password: PASSWORD }, ...proxied })
    expect(login.headers.get('set-cookie')).toContain('Secure')
    expect((await t.request('/api/system/migrate', { method: 'POST', ...proxied })).status).toBe(200)
    expect((await t.request('/api/apps', { method: 'POST', json: { name: 'proxied' }, ...proxied })).status).toBe(201)
    // Without the forwarded header the same Origin doesn't match.
    const direct = await t.request('/api/apps', { method: 'POST', json: { name: 'x' }, base: 'http://analytics.test', headers: { origin: 'https://analytics.test' } })
    expect(direct.status).toBe(403)
  })

  it('handles definition names with spaces and colons', async () => {
    const app = await bootstrap(t)
    const name = 'Checkout: Step 2'
    expect((await t.request(`/api/apps/${app.id}/definitions`, { method: 'POST', json: { name } })).status).toBe(201)
    const patched = await t.request(`/api/apps/${app.id}/definitions/${encodeURIComponent(name)}`, { method: 'PATCH', json: { description: 'x' } })
    expect(await patched.json()).toMatchObject({ definition: { name, description: 'x' } })
    expect((await t.request(`/api/apps/${app.id}/definitions/${encodeURIComponent(name)}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('ingests a batch and serves analytics', async () => {
    const app = await bootstrap(t)
    const now = Date.now()
    const res = await t.request('/v1/batch', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${app.writeKey}`,
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        'cf-ipcountry': 'de',
      },
      json: {
        sentAt: now,
        events: [
          { id: 'a', name: 'signup', anonymousId: 'anon-1', timestamp: now - 1000, properties: { method: 'email' } },
          { id: 'b', name: 'purchase', userId: 'user-1', properties: { plan: 'pro' }, context: { platform: 'ios', appVersion: '2.1.0' } },
          { name: 'bad name!' },
          { name: 'no_identity' },
        ],
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as IngestResponse
    expect(body.accepted).toBe(2)
    expect(body.rejected.map((r) => r.index)).toEqual([2, 3])

    const events = (await (await t.request(`/api/apps/${app.id}/events`)).json()) as { events: { id: string; os: string; country: string; platform: string; appVersion: string }[] }
    const byId = Object.fromEntries(events.events.map((e) => [e.id, e]))
    expect(byId.a).toMatchObject({ platform: 'web', os: 'iOS', country: 'DE' })
    expect(byId.b).toMatchObject({ platform: 'ios', appVersion: '2.1.0', os: null })

    const overview = (await (await t.request(`/api/apps/${app.id}/overview?range=24h`)).json()) as OverviewResponse
    expect(overview.totals).toEqual({ events: 2, users: 2 })
    expect(overview.buckets).toHaveLength(24)

    const insights = (await (await t.request(`/api/apps/${app.id}/insights?range=7d&groupBy=name&f=platform=ios`)).json()) as InsightsResponse
    expect(insights.series).toEqual([expect.objectContaining({ key: 'purchase', total: 1 })])

    const top = await (await t.request(`/api/apps/${app.id}/top?groupBy=country`)).json()
    expect(top).toMatchObject({ rows: [{ value: 'DE', events: 2 }] })

    const props = await (await t.request(`/api/apps/${app.id}/properties?event=purchase`)).json()
    expect(props).toEqual({ keys: ['plan'] })
  })

  it('accepts sendBeacon-style text bodies, gzip and /v1/track', async () => {
    const app = await bootstrap(t)
    const beacon = await t.request('/v1/batch', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ writeKey: app.writeKey, events: [{ name: 'beacon', anonymousId: 'x' }] }),
    })
    expect(((await beacon.json()) as IngestResponse).accepted).toBe(1)

    const gz = await t.request('/v1/batch', {
      method: 'POST',
      headers: { 'content-encoding': 'gzip', 'x-write-key': app.writeKey },
      body: gzipSync(JSON.stringify({ events: [{ name: 'zipped', anonymousId: 'x' }] })),
    })
    expect(((await gz.json()) as IngestResponse).accepted).toBe(1)

    const single = await t.request(`/v1/track?writeKey=${app.writeKey}`, { method: 'POST', json: { name: 'one', anonymousId: 'x' } })
    expect(((await single.json()) as IngestResponse).accepted).toBe(1)

    expect((await t.request('/v1/batch', { method: 'POST', json: { events: [{ name: 'x', anonymousId: 'x' }] } })).status).toBe(401)
    expect(
      (await t.request('/v1/batch', { method: 'POST', headers: { 'x-write-key': 'wk_nope' }, json: { events: [{ name: 'x', anonymousId: 'x' }] } })).status,
    ).toBe(401)
  })

  it('answers CORS preflight for ingestion', async () => {
    const res = await t.request('/v1/batch', {
      method: 'OPTIONS',
      headers: { origin: 'https://site.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('enforces definitions in strict mode', async () => {
    const app = await bootstrap(t)
    await t.request(`/api/apps/${app.id}/definitions`, {
      method: 'POST',
      json: { name: 'purchase', properties: [{ name: 'amount', type: 'number', required: true }] },
    })
    await t.request(`/api/apps/${app.id}/definitions`, { method: 'POST', json: { name: 'legacy', status: 'archived' } })
    await t.request(`/api/apps/${app.id}/definitions`, { method: 'POST', json: { name: 'legacy' } }).then((r) => expect(r.status).toBe(409))
    expect((await t.request(`/api/apps/${app.id}`, { method: 'PATCH', json: { schemaMode: 'strict' } })).status).toBe(200)

    const res = await t.request('/v1/batch', {
      method: 'POST',
      headers: { 'x-write-key': app.writeKey },
      json: {
        events: [
          { name: 'purchase', anonymousId: 'x', properties: { amount: 5 } },
          { name: 'purchase', anonymousId: 'x', properties: { amount: '5' } },
          { name: 'purchase', anonymousId: 'x' },
          { name: 'legacy', anonymousId: 'x' },
          { name: 'unknown', anonymousId: 'x' },
        ],
      },
    })
    const body = (await res.json()) as IngestResponse
    expect(body.accepted).toBe(1)
    expect(body.rejected.map((r) => r.reason)).toEqual([
      'property "amount" must be a number',
      'missing required property "amount"',
      'event "legacy" is archived',
      'event "unknown" is not defined (app is in strict mode)',
    ])

    // PATCH keeps fields it doesn't mention.
    await t.request(`/api/apps/${app.id}/definitions/purchase`, { method: 'PATCH', json: { description: 'Paid' } })
    const defs = (await (await t.request(`/api/apps/${app.id}/definitions`)).json()) as {
      definitions: { name: string; description: string; properties: unknown[]; events30d: number }[]
    }
    expect(defs.definitions.find((d) => d.name === 'purchase')).toMatchObject({ description: 'Paid', events30d: 1 })
    expect(defs.definitions.find((d) => d.name === 'purchase')!.properties).toHaveLength(1)
  })

  it('tracks errors, skipping definition checks for $ events in strict mode', async () => {
    const app = await bootstrap(t)
    await t.request(`/api/apps/${app.id}`, { method: 'PATCH', json: { schemaMode: 'strict' } })
    const res = await t.request('/v1/batch', {
      method: 'POST',
      headers: { 'x-write-key': app.writeKey },
      json: { events: [1, 2].map((n) => ({ name: '$error', anonymousId: `u${n}`, properties: { type: 'TypeError', message: `bad id ${n}`, fatal: true } })) },
    })
    expect(((await res.json()) as IngestResponse).accepted).toBe(2)
    const list = (await (await t.request(`/api/apps/${app.id}/errors`)).json()) as { groups: { fingerprint: string; events: number; users: number }[] }
    expect(list.groups).toHaveLength(1)
    expect(list.groups[0]).toMatchObject({ events: 2, users: 2 })
    const detail = await (await t.request(`/api/apps/${app.id}/errors/${list.groups[0]!.fingerprint}?range=24h`)).json()
    expect(detail).toMatchObject({ group: { events: 2 }, samples: [{ name: '$error' }, { name: '$error' }] })
    expect((detail as { points: number[] }).points.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('serves funnels, active users and property metrics', async () => {
    const app = await bootstrap(t)
    await t.request('/v1/batch', {
      method: 'POST',
      headers: { 'x-write-key': app.writeKey },
      json: {
        events: [
          { name: 'view', anonymousId: 'a', timestamp: Date.now() - 60_000 },
          { name: 'buy', anonymousId: 'a', properties: { amount: 9 } },
          { name: 'view', anonymousId: 'b' },
        ],
      },
    })
    const funnel = await (await t.request(`/api/apps/${app.id}/funnel?step=view&step=buy`)).json()
    expect(funnel).toMatchObject({ steps: [{ name: 'view', users: 2 }, { name: 'buy', users: 1, conversion: 0.5 }] })
    expect((await t.request(`/api/apps/${app.id}/funnel?step=view`)).status).toBe(400)
    expect(await (await t.request(`/api/apps/${app.id}/active-users`)).json()).toEqual({ dau: 2, wau: 2, mau: 2 })
    const sum = (await (await t.request(`/api/apps/${app.id}/insights?event=buy&metric=sum:amount`)).json()) as InsightsResponse
    expect(sum.series[0]!.total).toBe(9)
    const bad = (await (await t.request(`/api/apps/${app.id}/insights?metric=sum:bad key`)).json()) as InsightsResponse
    expect(bad.metric).toBe('events')
  })

  it('applies sampling settings at ingest', async () => {
    const app = await bootstrap(t)
    const sampling = { mode: 'sampled', strategy: 'user', rate: 0.5, overrides: [{ event: 'purchase', rate: 1 }] }
    const patched = await t.request(`/api/apps/${app.id}`, { method: 'PATCH', json: { sampling } })
    expect(await patched.json()).toMatchObject({ app: { sampling } })
    const bad = await t.request(`/api/apps/${app.id}`, { method: 'PATCH', json: { sampling: { ...sampling, rate: 0 } } })
    expect(bad.status).toBe(400)

    const events = Array.from({ length: 99 }, (_, i) => ({ id: `v${i}`, name: 'view', anonymousId: `u${i}` }))
    events.push({ id: 'p1', name: 'purchase', anonymousId: 'u1' })
    const body = (await (await t.request('/v1/batch', { method: 'POST', headers: { 'x-write-key': app.writeKey }, json: { events } })).json()) as IngestResponse
    expect(body.accepted + body.sampled).toBe(100)
    expect(body.sampled).toBeGreaterThan(30)
    expect(body.sampled).toBeLessThan(70)
    const top = (await (await t.request(`/api/apps/${app.id}/top?groupBy=name`)).json()) as { rows: { value: string; events: number }[] }
    // Estimates scale kept events back up; purchase is kept in full.
    expect(top.rows.find((r) => r.value === 'purchase')!.events).toBe(1)
    expect(top.rows.find((r) => r.value === 'view')!.events).toBe((body.accepted - 1) * 2)
  })

  it('rotating the key invalidates the old one', async () => {
    const app = await bootstrap(t)
    const send = (key: string) =>
      t.request('/v1/batch', { method: 'POST', headers: { 'x-write-key': key }, json: { events: [{ name: 'x', anonymousId: 'x' }] } })
    expect((await send(app.writeKey)).status).toBe(200)
    const rotated = ((await (await t.request(`/api/apps/${app.id}/rotate-key`, { method: 'POST' })).json()) as { app: App }).app
    expect(rotated.writeKey).not.toBe(app.writeKey)
    expect((await send(app.writeKey)).status).toBe(401)
    expect((await send(rotated.writeKey)).status).toBe(200)
  })

  it('deleting an app purges its events', async () => {
    const app = await bootstrap(t)
    await t.request('/v1/batch', { method: 'POST', headers: { 'x-write-key': app.writeKey }, json: { events: [{ name: 'x', anonymousId: 'x' }] } })
    expect((await t.request(`/api/apps/${app.id}`, { method: 'DELETE' })).status).toBe(200)
    await t.settle()
    const services = await t.services()
    expect(await services.repo.listApps({ includeDeleted: true })).toEqual([])
    expect(await services.repo.recentEvents(app.id, { limit: 10 })).toEqual([])
  })
})

describe('queue drivers', () => {
  const batch = (key: string) => ({
    method: 'POST',
    headers: { 'x-write-key': key },
    json: { events: [{ name: 'queued', anonymousId: 'x' }] },
  })

  it('background writes after the response', async () => {
    const t = setup({ QUEUE_DRIVER: 'background' })
    const app = await bootstrap(t)
    expect(((await (await t.request('/v1/batch', batch(app.writeKey))).json()) as IngestResponse).accepted).toBe(1)
    await t.settle()
    const services = await t.services()
    expect(await services.repo.recentEvents(app.id, { limit: 10 })).toHaveLength(1)
  })

  it('cloudflare sends to the queue binding and the consumer writes', async () => {
    const t = setup({ QUEUE_DRIVER: 'cloudflare' })
    const app = await bootstrap(t)
    await t.request('/v1/batch', batch(app.writeKey))
    const services = await t.services()
    expect(await services.repo.recentEvents(app.id, { limit: 10 })).toHaveLength(0)
    expect(t.sent).toHaveLength(1)
    expect(await consumeQueueBodies(services, t.sent)).toBe(1)
    expect(await consumeQueueBodies(services, t.sent)).toBe(0) // redelivery is idempotent
    expect(await services.repo.recentEvents(app.id, { limit: 10 })).toHaveLength(1)
  })

  it('refuses QStash deliveries without a valid signature', async () => {
    const t = setup({ QUEUE_DRIVER: 'qstash', QSTASH_TOKEN: 't', QSTASH_CURRENT_SIGNING_KEY: 'k1', QSTASH_NEXT_SIGNING_KEY: 'k2' })
    const res = await t.request('/api/queue/qstash', { method: 'POST', json: { v: 1, rows: [] }, headers: { 'upstash-signature': 'a.b.c' } })
    expect(res.status).toBe(401)
  })

  it('runs the retention cron only with the secret', async () => {
    const t = setup({ CRON_SECRET: 's3cret' })
    await bootstrap(t)
    expect((await t.request('/api/cron/retention')).status).toBe(401)
    const res = await t.request('/api/cron/retention', { headers: { authorization: 'Bearer s3cret' } })
    expect(await res.json()).toEqual({ deleted: 0, complete: true })
  })
})
