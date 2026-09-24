import type {
  ActiveUsers,
  ErrorDetailResponse,
  ErrorsResponse,
  EventsResponse,
  FunnelResponse,
  InsightsResponse,
  OverviewResponse,
  TopResponse,
} from '@serverless-analytics/core/types'
import { SNIPPET_LANGS, integrationSnippet, type SnippetLang } from '@serverless-analytics/mcp'
import { UsageError, parseKeyValue } from '../args.js'
import { qs, type QueryValue } from '../client.js'
import type { Context } from '../context.js'
import { date, format, percent, table } from '../output.js'
import { resolveApp } from './apps.js'

/** Shared query options: --range / --from --to, --tz, --interval, --filter k=v… */
function common(ctx: Context): Record<string, QueryValue> {
  const toMs = (v: string | undefined, label: string) => {
    if (!v) return undefined
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v)
    if (Number.isNaN(n)) throw new UsageError(`${label} must be a date or epoch ms`)
    return n
  }
  const range = ctx.args.get('range')
  if (range && !['24h', '7d', '30d', '90d'].includes(range)) throw new UsageError('--range must be 24h, 7d, 30d or 90d (or use --from/--to)')
  const filters = ctx.args.all('filter')
  for (const f of filters) if (f.indexOf('=') <= 0) throw new UsageError(`--filter expects field=value, e.g. platform=ios or prop:plan=pro`)
  return {
    range,
    from: toMs(ctx.args.get('from'), '--from'),
    to: toMs(ctx.args.get('to'), '--to'),
    interval: ctx.args.get('interval'),
    tz: ctx.tz,
    f: filters,
  }
}

async function target(ctx: Context) {
  const client = ctx.client()
  const app = await resolveApp(client, ctx.args.required(0, 'app'))
  return { client, app, base: `/api/apps/${encodeURIComponent(app.id)}` }
}

const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : ''}${(((cur - prev) / prev) * 100).toFixed(1)}%` : 'n/a')

export async function queryOverview(ctx: Context) {
  const { client, base } = await target(ctx)
  const o = await client.get<OverviewResponse>(`${base}/overview${qs(common(ctx))}`)
  ctx.out.result(o, () =>
    [
      `Events  ${format(o.totals.events)}  (${change(o.totals.events, o.previous.events)} vs previous period)`,
      `Users   ${format(o.totals.users)}  (${change(o.totals.users, o.previous.users)} vs previous period)`,
      '',
      table(
        o.buckets.map((b, i) => ({ t: date(b), events: o.events[i], users: o.users[i] })),
        [
          { key: 't', label: o.range.interval === 'hour' ? 'HOUR' : 'DAY' },
          { key: 'events', label: 'EVENTS', align: 'right' },
          { key: 'users', label: 'USERS', align: 'right' },
        ],
      ),
    ].join('\n'),
  )
}

export async function queryActive(ctx: Context) {
  const { client, base } = await target(ctx)
  const a = await client.get<ActiveUsers>(`${base}/active-users${qs({ f: ctx.args.all('filter') })}`)
  ctx.out.result(a, () => `DAU ${format(a.dau)} · WAU ${format(a.wau)} · MAU ${format(a.mau)} · stickiness ${a.mau ? percent(a.dau / a.mau) : 'n/a'}`)
}

export async function queryTop(ctx: Context) {
  const { client, base } = await target(ctx)
  const by = ctx.args.get('by')
  if (!by) throw new UsageError('--by is required, e.g. --by country or --by prop:plan')
  const t = await client.get<TopResponse>(`${base}/top${qs({ ...common(ctx), groupBy: by, limit: ctx.args.number('limit') })}`)
  ctx.out.result(t, () =>
    table(t.rows, [
      { key: 'value', label: by.toUpperCase() },
      { key: 'events', label: 'EVENTS', align: 'right' },
      { key: 'users', label: 'USERS', align: 'right' },
    ]),
  )
}

export async function queryTrend(ctx: Context) {
  const { client, base } = await target(ctx)
  const res = await client.get<InsightsResponse>(
    `${base}/insights${qs({ ...common(ctx), event: ctx.args.get('event'), metric: ctx.args.get('metric'), groupBy: ctx.args.get('by'), limit: ctx.args.number('limit') })}`,
  )
  const label = (k: string | null) => k ?? (res.groupBy ? '(none)' : (ctx.args.get('event') ?? 'all events'))
  ctx.out.result(res, () => {
    const cols = res.series.map((s, i) => ({ key: `s${i}`, label: label(s.key).slice(0, 18), align: 'right' as const }))
    return [
      `${res.metric}${res.groupBy ? ` by ${res.groupBy}` : ''}`,
      table(
        res.series.map((s) => ({ key: label(s.key), total: s.total })),
        [
          { key: 'key', label: 'SERIES' },
          { key: 'total', label: 'TOTAL', align: 'right' },
        ],
      ),
      '',
      table(
        res.buckets.map((b, i) => Object.fromEntries([['t', date(b)], ...res.series.map((s, j) => [`s${j}`, s.points[i]])])),
        [{ key: 't', label: res.range.interval === 'hour' ? 'HOUR' : 'DAY' }, ...cols],
      ),
    ].join('\n')
  })
}

export async function queryFunnel(ctx: Context) {
  const { client, base } = await target(ctx)
  const steps = ctx.args.all('step')
  if (steps.length < 2) throw new UsageError('Pass at least two --step options, in order')
  const res = await client.get<FunnelResponse>(`${base}/funnel${qs({ ...common(ctx), step: steps, window: ctx.args.number('window'), groupBy: ctx.args.get('by') })}`)
  const render = (rows: FunnelResponse['steps']) =>
    table(
      rows.map((s, i) => ({ step: `${i + 1}. ${s.name}`, users: s.users, conversion: percent(s.conversion), fromPrev: i ? percent(s.stepConversion) : '', time: s.medianTimeMs == null ? '' : `${(s.medianTimeMs / 60000).toFixed(1)} min` })),
      [
        { key: 'step', label: 'STEP' },
        { key: 'users', label: 'USERS', align: 'right' },
        { key: 'conversion', label: 'CONVERSION', align: 'right' },
        { key: 'fromPrev', label: 'FROM PREV', align: 'right' },
        { key: 'time', label: 'MEDIAN TIME', align: 'right' },
      ],
    )
  ctx.out.result(res, () =>
    [render(res.steps), ...res.groups.map((g) => `\n${ctx.args.get('by')} = ${g.key ?? '(none)'}\n${render(g.steps)}`), res.truncated ? '\n(sampled: too many users to scan fully)' : '']
      .join('\n')
      .trimEnd(),
  )
}

export async function queryErrors(ctx: Context) {
  const { client, base } = await target(ctx)
  const fingerprint = ctx.args.positionals[1]
  if (fingerprint) {
    const d = await client.get<ErrorDetailResponse>(`${base}/errors/${encodeURIComponent(fingerprint)}${qs(common(ctx))}`)
    ctx.out.result(d, () => {
      if (!d.group) return 'No occurrences in this period'
      const top = d.samples[0]
      return [
        `${d.group.type}: ${d.group.message}`,
        `${format(d.group.events)} events · ${format(d.group.users)} users · first ${date(d.group.firstSeen)} · last ${date(d.group.lastSeen)}`,
        `platforms: ${d.breakdown.platform.map((r) => `${r.value ?? '(none)'} ${r.events}`).join(', ')}`,
        `versions:  ${d.breakdown.appVersion.map((r) => `${r.value ?? '(none)'} ${r.events}`).join(', ')}`,
        top?.properties.stack ? `\nLatest stack:\n${String(top.properties.stack)}` : '',
      ].join('\n')
    })
    return
  }
  const res = await client.get<ErrorsResponse>(`${base}/errors${qs({ ...common(ctx), limit: ctx.args.number('limit') })}`)
  ctx.out.result(res, () =>
    [
      `${format(res.totals.events)} errors · ${format(res.totals.users)} users affected`,
      table(
        res.groups.map((g) => ({ ...g, issue: `${g.type}: ${(g.message ?? '').slice(0, 60)}`, last: date(g.lastSeen) })),
        [
          { key: 'fingerprint', label: 'ID' },
          { key: 'issue', label: 'ISSUE' },
          { key: 'events', label: 'EVENTS', align: 'right' },
          { key: 'users', label: 'USERS', align: 'right' },
          { key: 'last', label: 'LAST SEEN' },
        ],
      ),
    ].join('\n'),
  )
}

export async function queryEvents(ctx: Context) {
  const { client, base } = await target(ctx)
  const res = await client.get<EventsResponse>(`${base}/events${qs({ name: ctx.args.get('name'), limit: ctx.args.number('limit') ?? 20 })}`)
  ctx.out.result(res, () =>
    table(
      res.events.map((e) => ({ t: date(e.timestamp), name: e.name, user: e.distinctId, where: [e.platform, e.country, e.channel].filter(Boolean).join(' · '), props: e.properties })),
      [
        { key: 't', label: 'TIME' },
        { key: 'name', label: 'EVENT' },
        { key: 'user', label: 'USER' },
        { key: 'where', label: 'SOURCE' },
        { key: 'props', label: 'PROPERTIES' },
      ],
    ),
  )
}

/** sa track <app> <event> [--prop k=v]… — sends a real event with the app's write key. */
export async function track(ctx: Context) {
  const { client, app } = await target(ctx)
  const name = ctx.args.required(1, 'event')
  const properties = Object.fromEntries(ctx.args.all('prop').map(parseKeyValue))
  const event = {
    id: crypto.randomUUID(),
    name,
    anonymousId: ctx.args.get('anonymous-id') ?? 'serverless-analytics-cli',
    userId: ctx.args.get('user'),
    properties,
  }
  const res = await client.request<{ accepted: number; sampled: number; rejected: { reason: string }[] }>(
    'POST',
    '/v1/batch',
    { context: { platform: ctx.args.get('platform') ?? 'cli', channel: ctx.args.get('channel') }, events: [event] },
    { auth: false, headers: { authorization: `Bearer ${app.writeKey}` } },
  )
  ctx.out.result({ ...res, event }, () =>
    res.rejected.length ? `✗ Rejected: ${res.rejected[0]!.reason}` : res.sampled ? '• Accepted but sampled out by the app’s sampling settings' : `✓ Sent ${name} (${event.id})`,
  )
}

/** sa snippet <app> [--lang js|html|curl|kotlin|swift] — integration code with this app's endpoint and key. */
export async function snippet(ctx: Context) {
  const { client, app } = await target(ctx)
  const lang = (ctx.args.get('lang') ?? 'js') as SnippetLang
  if (!SNIPPET_LANGS.includes(lang)) throw new UsageError(`--lang must be one of ${SNIPPET_LANGS.join(', ')}`)
  const code = integrationSnippet(lang, client.endpoint, app.writeKey)
  ctx.out.result({ app: { id: app.id, name: app.name }, endpoint: client.endpoint, writeKey: app.writeKey, lang, code }, () => code)
}
