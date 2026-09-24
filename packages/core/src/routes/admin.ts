import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, checkPassword, createSessionToken, verifySessionToken } from '../auth.js'
import { migrate, migrationStatus } from '../db/migrations.js'
import { apiError, clampInt, parseFilters, parseRange, publicOrigin, readJson, type AppEnv } from '../http.js'
import { invalidateApp, runRetention } from '../services.js'
import type {
  App,
  AppWithStats,
  DefinitionsResponse,
  ErrorDetailResponse,
  ErrorsResponse,
  EventDefinition,
  EventsResponse,
  InsightsResponse,
  OverviewResponse,
  SystemResponse,
  TopResponse,
} from '../types.js'
import { ERROR_EVENT } from '../ingest/errors.js'
import { DAY } from '../util.js'
import { EVENT_NAME, PROPERTY_KEY, parseGroupBy } from '../validation.js'

export const VERSION = '0.1.0'

export const adminRoutes = new Hono<AppEnv>()

// Auth ------------------------------------------------------------------------

const clientIp = (c: Context) =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

const LOGIN_WINDOW_SECONDS = 900
const LOGIN_MAX_FAILURES = 10

adminRoutes.post('/auth/login', async (c) => {
  const { config, kv } = c.get('services')
  const body = z.object({ password: z.string().max(1024) }).safeParse(await readJson(c))
  if (!body.success) throw apiError(400, 'invalid_body', 'Password is required')

  // Best-effort throttling (KV is eventually consistent; this slows guessing, it isn't a hard limit).
  const key = `login-failures:${clientIp(c)}`
  const failures = Number((await kv.get(key).catch(() => null)) ?? 0)
  if (failures >= LOGIN_MAX_FAILURES) throw apiError(429, 'too_many_attempts', 'Too many failed attempts. Try again in 15 minutes.')

  if (!(await checkPassword(config.auth.adminPassword, body.data.password))) {
    await kv.set(key, String(failures + 1), LOGIN_WINDOW_SECONDS).catch(() => {})
    throw apiError(401, 'invalid_password', 'Incorrect password')
  }
  setCookie(c, SESSION_COOKIE, await createSessionToken(config.auth.sessionSecret), {
    httpOnly: true,
    secure: publicOrigin(c).startsWith('https:'),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return c.json({ authenticated: true })
})

adminRoutes.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ authenticated: false })
})

const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config } = c.get('services')
  if (!(await verifySessionToken(config.auth.sessionSecret, getCookie(c, SESSION_COOKIE)))) {
    throw apiError(401, 'unauthorized', 'Sign in to continue')
  }
  // CSRF: SameSite=Lax already blocks cross-site cookies on POST; also reject
  // mutating requests whose Origin doesn't match.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin')
    if (origin && origin !== publicOrigin(c)) throw apiError(403, 'bad_origin', 'Cross-origin request rejected')
  }
  await next()
}

adminRoutes.use('/system/*', requireSession)
adminRoutes.use('/system', requireSession)
adminRoutes.use('/apps/*', requireSession)
adminRoutes.use('/apps', requireSession)

// System ----------------------------------------------------------------------

adminRoutes.get('/system', async (c) => {
  const { config, repo, kv, queue, runtime } = c.get('services')
  const res: SystemResponse = {
    version: VERSION,
    runtime,
    database: { driver: config.database.driver, dialect: repo.dialect.name },
    kv: { driver: kv.driver },
    queue: { driver: queue.driver },
    migrations: await migrationStatus(repo.db),
  }
  return c.json(res)
})

adminRoutes.post('/system/migrate', async (c) => {
  const { repo } = c.get('services')
  const ran = await migrate(repo.db, repo.dialect.name)
  return c.json({ ran, ...(await migrationStatus(repo.db)) })
})

// Apps ------------------------------------------------------------------------

const appBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(64),
  schemaMode: z.enum(['permissive', 'strict']).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
})

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw apiError(400, 'invalid_body', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid body')
  }
  return result.data
}

adminRoutes.get('/apps', async (c) => {
  const tz = clampInt(c.req.query('tz'), 0, -840, 840)
  const apps: AppWithStats[] = await c.get('services').repo.listAppsWithStats(Date.now(), tz)
  return c.json({ apps })
})

adminRoutes.post('/apps', async (c) => {
  const body = parse(appBody, await readJson(c))
  const app = await c.get('services').repo.createApp(body)
  return c.json({ app }, 201)
})

async function loadApp(c: Context<AppEnv>): Promise<App> {
  const app = await c.get('services').repo.getApp(c.req.param('id') ?? '')
  if (!app) throw apiError(404, 'app_not_found', 'App not found')
  return app
}

adminRoutes.get('/apps/:id', async (c) => c.json({ app: await loadApp(c) }))

adminRoutes.patch('/apps/:id', async (c) => {
  const services = c.get('services')
  const current = await loadApp(c)
  const body = parse(appBody.partial(), await readJson(c))
  const app = await services.repo.updateApp(current.id, body)
  await invalidateApp(services, current)
  return c.json({ app })
})

adminRoutes.post('/apps/:id/rotate-key', async (c) => {
  const services = c.get('services')
  const current = await loadApp(c)
  const app = await services.repo.rotateWriteKey(current.id)
  await invalidateApp(services, current)
  return c.json({ app })
})

adminRoutes.delete('/apps/:id', async (c) => {
  const services = c.get('services')
  const app = await loadApp(c)
  await services.repo.markAppDeleted(app.id)
  await invalidateApp(services, app)
  // Start purging right away; the retention cron finishes whatever is left.
  services.waitUntil(runRetention(services, 15_000).catch((error) => console.error('[retention]', error)))
  return c.json({ deleted: true })
})

// Analytics -------------------------------------------------------------------

adminRoutes.get('/apps/:id/overview', async (c) => {
  const app = await loadApp(c)
  const res: OverviewResponse = await c.get('services').repo.overview(app.id, parseRange(c), parseFilters(c))
  return c.json(res)
})

adminRoutes.get('/apps/:id/top', async (c) => {
  const app = await loadApp(c)
  const groupBy = parseGroupBy(c.req.query('groupBy'))
  if (!groupBy) throw apiError(400, 'invalid_group_by', 'groupBy must be a dimension or prop:<key>')
  const limit = clampInt(c.req.query('limit'), 10, 1, 100)
  const res: TopResponse = await c.get('services').repo.top(app.id, parseRange(c), groupBy, limit, parseFilters(c))
  return c.json(res)
})

adminRoutes.get('/apps/:id/insights', async (c) => {
  const app = await loadApp(c)
  const groupByRaw = c.req.query('groupBy')
  const groupBy = parseGroupBy(groupByRaw)
  if (groupByRaw && !groupBy) throw apiError(400, 'invalid_group_by', 'groupBy must be a dimension or prop:<key>')
  const event = c.req.query('event') || null
  const res: InsightsResponse = await c.get('services').repo.insights(app.id, {
    range: parseRange(c),
    event,
    metric: c.req.query('metric') === 'users' ? 'users' : 'events',
    groupBy,
    filters: parseFilters(c),
    limit: clampInt(c.req.query('limit'), 8, 1, 20),
  })
  return c.json(res)
})

adminRoutes.get('/apps/:id/events', async (c) => {
  const app = await loadApp(c)
  const before = Number(c.req.query('before'))
  const res: EventsResponse = {
    events: await c.get('services').repo.recentEvents(app.id, {
      limit: clampInt(c.req.query('limit'), 50, 1, 200),
      before: Number.isFinite(before) && before > 0 ? before : undefined,
      name: c.req.query('name') || undefined,
    }),
  }
  return c.json(res)
})

adminRoutes.get('/apps/:id/properties', async (c) => {
  const services = c.get('services')
  const app = await loadApp(c)
  const event = c.req.query('event') || null
  const [seen, definitions] = await Promise.all([services.repo.propertyKeys(app.id, event), services.repo.listDefinitions(app.id)])
  const defined = definitions.filter((d) => !event || d.name === event).flatMap((d) => d.properties.map((p) => p.name))
  return c.json({ keys: [...new Set([...defined, ...seen])] })
})

// Errors ----------------------------------------------------------------------

adminRoutes.get('/apps/:id/errors', async (c) => {
  const app = await loadApp(c)
  const res: ErrorsResponse = await c.get('services').repo.errorGroups(app.id, parseRange(c), parseFilters(c), clampInt(c.req.query('limit'), 50, 1, 200))
  return c.json(res)
})

adminRoutes.get('/apps/:id/errors/:fingerprint', async (c) => {
  const { repo } = c.get('services')
  const app = await loadApp(c)
  const fingerprint = c.req.param('fingerprint')
  const range = parseRange(c)
  const filters = [...parseFilters(c), { by: 'prop:$fingerprint' as const, value: fingerprint }]
  const top = (by: 'platform' | 'app_version' | 'os') =>
    repo.top(app.id, range, by, 5, [...filters, { by: 'name' as const, value: ERROR_EVENT }]).then((r) => r.rows)
  const [groups, series, samples, platform, appVersion, os] = await Promise.all([
    repo.errorGroups(app.id, range, parseFilters(c), 1, fingerprint),
    repo.insights(app.id, { range, event: ERROR_EVENT, metric: 'events', groupBy: null, filters, limit: 1 }),
    repo.recentEvents(app.id, { limit: 20, name: ERROR_EVENT, filters }),
    top('platform'),
    top('app_version'),
    top('os'),
  ])
  const res: ErrorDetailResponse = {
    group: groups.groups[0] ?? null,
    buckets: series.buckets,
    points: series.series[0]?.points ?? series.buckets.map(() => 0),
    samples,
    breakdown: { platform, appVersion, os },
  }
  return c.json(res)
})

// Event definitions -----------------------------------------------------------

const propertyDefinition = z.object({
  name: z.string().regex(PROPERTY_KEY, 'Invalid property name'),
  type: z.enum(['string', 'number', 'boolean', 'any']),
  required: z.boolean().default(false),
  description: z.string().max(500).default(''),
})

const uniqueNames = (props: { name: string }[]) => new Set(props.map((p) => p.name)).size === props.length

// No defaults here: zod applies defaults even inside .partial(), which would
// reset untouched fields on PATCH.
const definitionPatch = z.object({
  description: z.string().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  properties: z.array(propertyDefinition).max(100).refine(uniqueNames, 'Property names must be unique').optional(),
})

const definitionCreate = z.object({
  name: z.string().regex(EVENT_NAME, 'Invalid event name'),
  description: z.string().max(1000).default(''),
  status: z.enum(['active', 'archived']).default('active'),
  properties: z.array(propertyDefinition).max(100).refine(uniqueNames, 'Property names must be unique').default([]),
})

adminRoutes.get('/apps/:id/definitions', async (c) => {
  const services = c.get('services')
  const app = await loadApp(c)
  const [definitions, stats] = await Promise.all([
    services.repo.listDefinitions(app.id),
    services.repo.eventNameStats(app.id, Date.now() - 30 * DAY),
  ])
  const byName = new Map(stats.map((s) => [s.name, s]))
  const res: DefinitionsResponse = {
    definitions: definitions.map((d) => ({ ...d, events30d: byName.get(d.name)?.events ?? 0, lastSeen: byName.get(d.name)?.lastSeen ?? null })),
    undefinedEvents: stats
      .filter((s) => !definitions.some((d) => d.name === s.name))
      .map((s) => ({ name: s.name, events30d: s.events, lastSeen: s.lastSeen }))
      .sort((a, b) => b.events30d - a.events30d),
  }
  return c.json(res)
})

adminRoutes.post('/apps/:id/definitions', async (c) => {
  const services = c.get('services')
  const app = await loadApp(c)
  const body = parse(definitionCreate, await readJson(c))
  if (await services.repo.getDefinition(app.id, body.name)) {
    throw apiError(409, 'definition_exists', `Event "${body.name}" is already defined`)
  }
  const definition: EventDefinition = await services.repo.createDefinition({ appId: app.id, ...body })
  await invalidateApp(services, app)
  return c.json({ definition }, 201)
})

adminRoutes.patch('/apps/:id/definitions/:name', async (c) => {
  const services = c.get('services')
  const app = await loadApp(c)
  const name = c.req.param('name')
  if (!(await services.repo.getDefinition(app.id, name))) throw apiError(404, 'definition_not_found', 'Definition not found')
  const body = parse(definitionPatch, await readJson(c))
  const definition = await services.repo.updateDefinition(app.id, name, body)
  await invalidateApp(services, app)
  return c.json({ definition })
})

adminRoutes.delete('/apps/:id/definitions/:name', async (c) => {
  const services = c.get('services')
  const app = await loadApp(c)
  await services.repo.deleteDefinition(app.id, c.req.param('name'))
  await invalidateApp(services, app)
  return c.json({ deleted: true })
})
