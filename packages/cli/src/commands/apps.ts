import type { App, AppWithStats, DefinitionsResponse, EventDefinition, PropertyType, SamplingConfig } from '@serverless-analytics/core/types'
import { UsageError } from '../args.js'
import type { Client } from '../client.js'
import type { Context } from '../context.js'
import { date, percent, table } from '../output.js'

/** Accepts an app id or its (case-insensitive) name. */
export async function resolveApp(client: Client, ref: string): Promise<App> {
  const { apps } = await client.get<{ apps: AppWithStats[] }>('/api/apps')
  const byId = apps.find((a) => a.id === ref)
  if (byId) return byId
  const matches = apps.filter((a) => a.name.toLowerCase() === ref.toLowerCase())
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new UsageError(`Several apps are named "${ref}"; use the id (${matches.map((a) => a.id).join(', ')})`)
  throw new UsageError(`No app "${ref}". List apps with: sa apps list`)
}

const appPath = (app: App) => `/api/apps/${encodeURIComponent(app.id)}`
const mask = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`

function describeApp(app: App, reveal: boolean) {
  const s = app.sampling
  return [
    `${app.name}  (${app.id})`,
    `  write key     ${reveal ? app.writeKey : `${mask(app.writeKey)}  (--reveal to show)`}`,
    `  schema mode   ${app.schemaMode}`,
    `  retention     ${app.retentionDays} days`,
    `  sampling      ${s.mode === 'full' ? 'full' : `${s.strategy} · ${percent(s.rate)}${s.overrides.length ? ` · ${s.overrides.map((o) => `${o.event}=${percent(o.rate)}`).join(', ')}` : ''}`}`,
    `  created       ${date(app.createdAt)}`,
  ].join('\n')
}

// sa apps list | create | get | update | rotate-key | delete
export async function appsList(ctx: Context) {
  const res = await ctx.client().get<{ apps: AppWithStats[] }>(`/api/apps?tz=${ctx.tz}`)
  ctx.out.result(res, () =>
    table(
      res.apps.map((a) => ({ ...a, sampling: a.sampling.mode === 'full' ? 'full' : percent(a.sampling.rate), week: a.sparkline.reduce((x, y) => x + y, 0) })),
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'NAME' },
        { key: 'schemaMode', label: 'SCHEMA' },
        { key: 'sampling', label: 'SAMPLING' },
        { key: 'events24h', label: 'EVENTS 24H', align: 'right' },
        { key: 'week', label: 'EVENTS 7D', align: 'right' },
      ],
    ),
  )
}

export async function appsCreate(ctx: Context) {
  const name = ctx.args.required(2, 'name')
  const { app } = await ctx.client().post<{ app: App }>('/api/apps', {
    name,
    schemaMode: ctx.args.has('strict') ? 'strict' : 'permissive',
    retentionDays: ctx.args.number('retention-days'),
  })
  ctx.out.result({ app }, () => `✓ Created\n${describeApp(app, true)}\n\nNext: sa snippet ${app.id} --lang js`)
}

export async function appsGet(ctx: Context) {
  const app = await resolveApp(ctx.client(), ctx.args.required(2, 'app'))
  ctx.out.result({ app }, () => describeApp(app, ctx.args.has('reveal')))
}

export async function appsUpdate(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  const mode = ctx.args.get('schema-mode')
  if (mode && mode !== 'permissive' && mode !== 'strict') throw new UsageError('--schema-mode must be permissive or strict')
  const patch = { name: ctx.args.get('name'), schemaMode: mode, retentionDays: ctx.args.number('retention-days') }
  if (Object.values(patch).every((v) => v === undefined)) throw new UsageError('Nothing to update: pass --name, --schema-mode or --retention-days')
  const res = await client.patch<{ app: App }>(appPath(app), patch)
  ctx.out.result(res, () => `✓ Updated\n${describeApp(res.app, false)}`)
}

export async function appsRotateKey(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  ctx.requireYes(`Rotating stops the current write key of "${app.name}" immediately.`)
  const res = await client.post<{ app: App }>(`${appPath(app)}/rotate-key`)
  ctx.out.result(res, () => `✓ New write key: ${res.app.writeKey}`)
}

export async function appsDelete(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  ctx.requireYes(`This permanently deletes "${app.name}" and all of its events.`)
  ctx.out.result(await client.delete(appPath(app)), () => `✓ Deleted ${app.name}`)
}

// sa sampling get | set -------------------------------------------------------

export async function samplingGet(ctx: Context) {
  const app = await resolveApp(ctx.client(), ctx.args.required(2, 'app'))
  ctx.out.result({ sampling: app.sampling }, () => describeApp(app, false).split('\n').find((l) => l.includes('sampling'))!.trim())
}

const parseRate = (value: string, label: string) => {
  const n = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new UsageError(`${label} must be between 0 and 1 (or 0%–100%), got "${value}"`)
  return n
}

export async function samplingSet(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  const current = app.sampling
  const mode = (ctx.args.get('mode') ?? (ctx.args.get('rate') ? 'sampled' : current.mode)) as SamplingConfig['mode']
  if (mode !== 'full' && mode !== 'sampled') throw new UsageError('--mode must be full or sampled')
  const strategy = (ctx.args.get('strategy') ?? current.strategy) as SamplingConfig['strategy']
  if (strategy !== 'user' && strategy !== 'event') throw new UsageError('--strategy must be user or event')
  const rateArg = ctx.args.get('rate')
  const rate = rateArg ? parseRate(rateArg, '--rate') : current.rate
  if (mode === 'sampled' && rate <= 0) throw new UsageError('--rate must be greater than 0')

  const overrides = new Map(ctx.args.has('clear-overrides') ? [] : current.overrides.map((o) => [o.event, o.rate]))
  for (const o of ctx.args.all('override')) {
    const i = o.lastIndexOf('=')
    if (i <= 0) throw new UsageError(`--override expects event=rate, got "${o}"`)
    overrides.set(o.slice(0, i), parseRate(o.slice(i + 1), `--override ${o.slice(0, i)}`))
  }
  for (const e of ctx.args.all('remove-override')) overrides.delete(e)

  const sampling: SamplingConfig = { mode, strategy, rate, overrides: [...overrides].map(([event, r]) => ({ event, rate: r })) }
  const res = await client.patch<{ app: App }>(appPath(app), { sampling })
  ctx.out.result({ sampling: res.app.sampling }, () => `✓ ${describeApp(res.app, false).split('\n').find((l) => l.includes('sampling'))!.trim()}`)
}

// sa events list | define | update | delete -----------------------------------

const TYPES: PropertyType[] = ['string', 'number', 'boolean', 'any']

/** --prop name:type[:required][:description] */
export function parseProp(spec: string) {
  const [name, type = 'any', ...rest] = spec.split(':')
  if (!name) throw new UsageError(`Invalid --prop "${spec}"`)
  if (!TYPES.includes(type as PropertyType)) throw new UsageError(`--prop ${name}: type must be one of ${TYPES.join(', ')}`)
  const required = rest[0] === 'required'
  const description = (required ? rest.slice(1) : rest).join(':')
  return { name, type: type as PropertyType, required, description }
}

export async function eventsList(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  const res = await client.get<DefinitionsResponse>(`${appPath(app)}/definitions`)
  ctx.out.result(res, () =>
    [
      `Defined events (${app.schemaMode} mode)`,
      table(
        res.definitions.map((d) => ({
          ...d,
          props: d.properties.map((p) => `${p.name}:${p.type}${p.required ? '*' : ''}`).join(' ') || '—',
        })),
        [
          { key: 'name', label: 'NAME' },
          { key: 'status', label: 'STATUS' },
          { key: 'props', label: 'PROPERTIES (* required)' },
          { key: 'events30d', label: '30D', align: 'right' },
          { key: 'description', label: 'DESCRIPTION' },
        ],
      ),
      '',
      'Seen but not defined (last 30 days)',
      table(res.undefinedEvents, [
        { key: 'name', label: 'NAME' },
        { key: 'events30d', label: '30D', align: 'right' },
      ]),
    ].join('\n'),
  )
}

export async function eventsDefine(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  const name = ctx.args.required(3, 'event')
  const res = await client.post<{ definition: EventDefinition }>(`${appPath(app)}/definitions`, {
    name,
    description: ctx.args.get('description') ?? '',
    status: ctx.args.has('archived') ? 'archived' : 'active',
    properties: ctx.args.all('prop').map(parseProp),
  })
  ctx.out.result(res, () => `✓ Defined ${name} (${res.definition.properties.length} properties)`)
}

export async function eventsUpdate(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  const name = ctx.args.required(3, 'event')
  const status = ctx.args.get('status')
  if (status && status !== 'active' && status !== 'archived') throw new UsageError('--status must be active or archived')
  const props = ctx.args.all('prop')
  const patch = { description: ctx.args.get('description'), status, properties: props.length || ctx.args.has('clear-props') ? props.map(parseProp) : undefined }
  const res = await client.patch<{ definition: EventDefinition }>(`${appPath(app)}/definitions/${encodeURIComponent(name)}`, patch)
  ctx.out.result(res, () => `✓ Updated ${name}`)
}

export async function eventsDelete(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(2, 'app'))
  const name = ctx.args.required(3, 'event')
  ctx.requireYes(`This deletes the definition of "${name}" (events are kept).`)
  ctx.out.result(await client.delete(`${appPath(app)}/definitions/${encodeURIComponent(name)}`), () => `✓ Deleted definition ${name}`)
}

