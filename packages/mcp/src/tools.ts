import type {
  ActiveUsers,
  App,
  AppWithStats,
  DefinitionsResponse,
  ErrorDetailResponse,
  ErrorsResponse,
  EventDefinition,
  EventsResponse,
  FunnelResponse,
  IngestResponse,
  InsightsResponse,
  OverviewResponse,
  SamplingConfig,
  SystemResponse,
  TopResponse,
} from '@serverless-analytics/core/types'
import { ApiError, appPath, qs, resolveApp, type Api } from './api.js'
import { SNIPPET_LANGS, integrationSnippet, type SnippetLang } from './snippets.js'

type Json = Record<string, unknown>
type Schema = Json

export interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Schema
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  run(api: Api, args: Json, ctx: { tzOffset: number }): Promise<unknown>
}

// Schema helpers ----------------------------------------------------------------

const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra })
const num = (description: string, extra: Json = {}) => ({ type: 'number', description, ...extra })
const bool = (description: string) => ({ type: 'boolean', description })
const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

const APP = str('App id or name (see list_apps)')
const FIELDS = 'name, platform, channel, country, region, os, os_version, browser, app_version, device, locale, or prop:<property>'
const RANGE = str('Time range, ending now. Ignored when from/to are given.', { enum: ['24h', '7d', '30d', '90d'], default: '7d' })
const FROM = str('Start of a custom range (ISO date or epoch ms)')
const TO = str('End of a custom range (ISO date or epoch ms)')
const FILTERS = {
  type: 'object',
  description: `Only count events matching every field=value pair. Keys: ${FIELDS}. Example: {"platform":"ios","prop:plan":"pro"}`,
  additionalProperties: { type: 'string' },
}
const TZ = num('Timezone offset in minutes east of UTC for day/hour buckets (e.g. 480 for UTC+8). Defaults to the server/CLI default.')
const PROPERTY = obj(
  {
    name: str('Property key'),
    type: str('Expected type', { enum: ['string', 'number', 'boolean', 'any'] }),
    required: bool('Whether every event must carry it'),
    description: str('What it means'),
  },
  ['name', 'type'],
)

// Argument helpers ---------------------------------------------------------------

const s = (args: Json, key: string) => (typeof args[key] === 'string' && args[key] !== '' ? (args[key] as string) : undefined)
const n = (args: Json, key: string) => (typeof args[key] === 'number' ? (args[key] as number) : undefined)
function need(args: Json, key: string): string {
  const v = s(args, key)
  if (!v) throw new ApiError(400, 'invalid_arguments', `"${key}" is required`)
  return v
}
function confirm(args: Json, what: string) {
  if (args.confirm !== true) throw new ApiError(400, 'confirmation_required', `${what} Ask the user, then call again with confirm: true.`)
}
const toMs = (v: string | undefined) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : Date.parse(v))

function common(args: Json, ctx: { tzOffset: number }) {
  const filters = args.filters && typeof args.filters === 'object' ? Object.entries(args.filters as Record<string, unknown>) : []
  return {
    range: s(args, 'range'),
    from: toMs(s(args, 'from')),
    to: toMs(s(args, 'to')),
    interval: s(args, 'interval'),
    tz: n(args, 'tz') ?? ctx.tzOffset,
    f: filters.map(([k, v]) => `${k}=${String(v)}`),
  }
}

const target = async (api: Api, args: Json) => {
  const app = await resolveApp(api, need(args, 'app'))
  return { app, base: appPath(app) }
}

const summarizeApp = (a: App | AppWithStats) => ({
  id: a.id,
  name: a.name,
  schemaMode: a.schemaMode,
  retentionDays: a.retentionDays,
  sampling: a.sampling,
  ...('events24h' in a ? { events24h: a.events24h, eventsLast7Days: a.sparkline.reduce((x, y) => x + y, 0) } : {}),
})

// Tools ----------------------------------------------------------------------------

export const TOOLS: Tool[] = [
  {
    name: 'get_status',
    title: 'Deployment status',
    description: 'Endpoint, runtime, storage/queue drivers and pending migrations of the analytics deployment.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    run: async (api) => ({ endpoint: api.endpoint, system: await api.request<SystemResponse>('GET', '/api/system') }),
  },
  {
    name: 'list_apps',
    title: 'List apps',
    description: 'All apps (tracked projects) with schema mode, sampling and recent volume. Write keys are omitted; use get_app.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    run: async (api) => ({ apps: (await api.request<{ apps: AppWithStats[] }>('GET', '/api/apps')).apps.map(summarizeApp) }),
  },
  {
    name: 'get_app',
    title: 'Get app',
    description: 'One app including its write key (public, write-only; safe to embed in client code).',
    inputSchema: obj({ app: APP }, ['app']),
    annotations: { readOnlyHint: true },
    run: async (api, args) => ({ app: await resolveApp(api, need(args, 'app')) }),
  },
  {
    name: 'create_app',
    title: 'Create app',
    description: 'Create an app for a project to send events to. Returns its write key. Check list_apps first to avoid duplicates.',
    inputSchema: obj(
      {
        name: str('Display name, e.g. "Acme iOS"'),
        strict: bool('Reject events that are not defined (default false: accept everything)'),
        retention_days: num('Days to keep events (default 365)', { minimum: 1, maximum: 3650 }),
      },
      ['name'],
    ),
    annotations: {},
    run: async (api, args) =>
      api.request<{ app: App }>('POST', '/api/apps', {
        name: need(args, 'name'),
        schemaMode: args.strict === true ? 'strict' : 'permissive',
        retentionDays: n(args, 'retention_days'),
      }),
  },
  {
    name: 'update_app',
    title: 'Update app',
    description: 'Rename an app, switch schema mode (permissive accepts all events; strict rejects undefined ones) or change retention.',
    inputSchema: obj(
      {
        app: APP,
        name: str('New name'),
        schema_mode: str('Schema mode', { enum: ['permissive', 'strict'] }),
        retention_days: num('Days to keep events', { minimum: 1, maximum: 3650 }),
      },
      ['app'],
    ),
    annotations: { idempotentHint: true },
    run: async (api, args) => {
      const { base } = await target(api, args)
      return api.request<{ app: App }>('PATCH', base, { name: s(args, 'name'), schemaMode: s(args, 'schema_mode'), retentionDays: n(args, 'retention_days') })
    },
  },
  {
    name: 'rotate_write_key',
    title: 'Rotate write key',
    description: 'Replace an app’s write key. The old key stops working immediately, so clients must ship the new one. Requires confirm: true.',
    inputSchema: obj({ app: APP, confirm: bool('Set to true after the user agreed') }, ['app']),
    annotations: { destructiveHint: true },
    run: async (api, args) => {
      const { app, base } = await target(api, args)
      confirm(args, `Rotating stops the current write key of "${app.name}" immediately.`)
      return api.request<{ app: App }>('POST', `${base}/rotate-key`)
    },
  },
  {
    name: 'delete_app',
    title: 'Delete app',
    description: 'Permanently delete an app, its definitions and all its events. Requires confirm: true.',
    inputSchema: obj({ app: APP, confirm: bool('Set to true after the user agreed') }, ['app']),
    annotations: { destructiveHint: true },
    run: async (api, args) => {
      const { app, base } = await target(api, args)
      confirm(args, `This permanently deletes "${app.name}" and all of its events.`)
      return api.request('DELETE', base)
    },
  },
  {
    name: 'get_integration_snippet',
    title: 'Integration code',
    description: 'Ready-to-paste code that sends events to this app (endpoint and write key filled in).',
    inputSchema: obj({ app: APP, lang: str('Target', { enum: [...SNIPPET_LANGS] }) }, ['app', 'lang']),
    annotations: { readOnlyHint: true },
    run: async (api, args) => {
      const app = await resolveApp(api, need(args, 'app'))
      const lang = need(args, 'lang') as SnippetLang
      if (!SNIPPET_LANGS.includes(lang)) throw new ApiError(400, 'invalid_arguments', `lang must be one of ${SNIPPET_LANGS.join(', ')}`)
      return {
        endpoint: api.endpoint,
        writeKey: app.writeKey,
        lang,
        code: integrationSnippet(lang, api.endpoint, app.writeKey),
        notes: [
          'Give every event a UUID id and keep it on retries (duplicates are ignored).',
          'Send context.platform, appVersion and channel (store / distribution channel) once per batch.',
          'Batch events and flush on a timer and when the app goes to the background.',
        ],
      }
    },
  },
  {
    name: 'send_test_event',
    title: 'Send test event',
    description: 'Send one real event with the app’s write key to verify an integration or a definition. Shows whether it was accepted, rejected (and why) or sampled out.',
    inputSchema: obj(
      {
        app: APP,
        event: str('Event name'),
        properties: { type: 'object', description: 'Event properties', additionalProperties: true },
        user_id: str('Optional user id'),
        channel: str('Optional channel'),
        platform: str('Platform to report (default "mcp")'),
      },
      ['app', 'event'],
    ),
    annotations: { openWorldHint: false },
    run: async (api, args) => {
      const app = await resolveApp(api, need(args, 'app'))
      const event = {
        id: crypto.randomUUID(),
        name: need(args, 'event'),
        anonymousId: 'serverless-analytics-mcp',
        userId: s(args, 'user_id'),
        properties: (args.properties as Json | undefined) ?? {},
      }
      const res = await api.ingest<IngestResponse>(app.writeKey, { context: { platform: s(args, 'platform') ?? 'mcp', channel: s(args, 'channel') }, events: [event] })
      return { ...res, event }
    },
  },
  {
    name: 'list_event_definitions',
    title: 'List event definitions',
    description: 'The app’s tracking plan: defined events with property schemas and 30-day volume, plus events seen but not defined.',
    inputSchema: obj({ app: APP }, ['app']),
    annotations: { readOnlyHint: true },
    run: async (api, args) => {
      const { base } = await target(api, args)
      return api.request<DefinitionsResponse>('GET', `${base}/definitions`)
    },
  },
  {
    name: 'define_event',
    title: 'Define event',
    description: 'Add an event to the tracking plan with its properties. In strict mode only defined events (with required properties present and correctly typed) are accepted.',
    inputSchema: obj(
      {
        app: APP,
        name: str('Event name, e.g. checkout_completed'),
        description: str('When the event is sent'),
        properties: { type: 'array', items: PROPERTY, description: 'Expected properties' },
      },
      ['app', 'name'],
    ),
    annotations: {},
    run: async (api, args) => {
      const { base } = await target(api, args)
      return api.request<{ definition: EventDefinition }>('POST', `${base}/definitions`, {
        name: need(args, 'name'),
        description: s(args, 'description') ?? '',
        properties: normalizeProps(args.properties),
      })
    },
  },
  {
    name: 'update_event_definition',
    title: 'Update event definition',
    description: 'Change an event’s description, status (archived events are rejected in strict mode) or properties. properties replaces the whole list.',
    inputSchema: obj(
      {
        app: APP,
        name: str('Event name'),
        description: str('New description'),
        status: str('Status', { enum: ['active', 'archived'] }),
        properties: { type: 'array', items: PROPERTY, description: 'Replaces all properties' },
      },
      ['app', 'name'],
    ),
    annotations: { idempotentHint: true },
    run: async (api, args) => {
      const { base } = await target(api, args)
      return api.request<{ definition: EventDefinition }>('PATCH', `${base}/definitions/${encodeURIComponent(need(args, 'name'))}`, {
        description: s(args, 'description'),
        status: s(args, 'status'),
        properties: args.properties === undefined ? undefined : normalizeProps(args.properties),
      })
    },
  },
  {
    name: 'delete_event_definition',
    title: 'Delete event definition',
    description: 'Remove an event from the tracking plan (stored events are kept). Requires confirm: true.',
    inputSchema: obj({ app: APP, name: str('Event name'), confirm: bool('Set to true after the user agreed') }, ['app', 'name']),
    annotations: { destructiveHint: true },
    run: async (api, args) => {
      const { base } = await target(api, args)
      confirm(args, `This deletes the definition of "${need(args, 'name')}".`)
      return api.request('DELETE', `${base}/definitions/${encodeURIComponent(need(args, 'name'))}`)
    },
  },
  {
    name: 'set_sampling',
    title: 'Configure sampling',
    description:
      'Store all events (mode "full") or a share of them ("sampled"). Strategy "user" keeps whole user journeys (recommended; funnels stay accurate), "event" samples each event. overrides set per-event rates (1 keeps all, 0 drops). Charts show full-volume estimates.',
    inputSchema: obj(
      {
        app: APP,
        mode: str('full or sampled', { enum: ['full', 'sampled'] }),
        strategy: str('Sampling strategy', { enum: ['user', 'event'] }),
        rate: num('Share to keep, 0 < rate ≤ 1 (e.g. 0.1)', { exclusiveMinimum: 0, maximum: 1 }),
        overrides: {
          type: 'array',
          description: 'Per-event rates; replaces existing overrides when given',
          items: obj({ event: str('Event name'), rate: num('0–1', { minimum: 0, maximum: 1 }) }, ['event', 'rate']),
        },
      },
      ['app'],
    ),
    annotations: { idempotentHint: true },
    run: async (api, args) => {
      const { app, base } = await target(api, args)
      const current = app.sampling
      const sampling: SamplingConfig = {
        mode: (s(args, 'mode') ?? (n(args, 'rate') !== undefined ? 'sampled' : current.mode)) as SamplingConfig['mode'],
        strategy: (s(args, 'strategy') ?? current.strategy) as SamplingConfig['strategy'],
        rate: n(args, 'rate') ?? current.rate,
        overrides: Array.isArray(args.overrides) ? (args.overrides as SamplingConfig['overrides']) : current.overrides,
      }
      const res = await api.request<{ app: App }>('PATCH', base, { sampling })
      return { sampling: res.app.sampling }
    },
  },
  {
    name: 'query_overview',
    title: 'Overview',
    description: 'Total events and unique users for a period, the previous period for comparison, and a time series.',
    inputSchema: obj({ app: APP, range: RANGE, from: FROM, to: TO, filters: FILTERS, tz: TZ }, ['app']),
    annotations: { readOnlyHint: true },
    run: async (api, args, ctx) => {
      const { base } = await target(api, args)
      return api.request<OverviewResponse>('GET', `${base}/overview${qs(common(args, ctx))}`)
    },
  },
  {
    name: 'query_active_users',
    title: 'Active users',
    description: 'DAU, WAU and MAU (unique users in the trailing 24 h / 7 d / 30 d) and stickiness.',
    inputSchema: obj({ app: APP, filters: FILTERS }, ['app']),
    annotations: { readOnlyHint: true },
    run: async (api, args, ctx) => {
      const { base } = await target(api, args)
      const a = await api.request<ActiveUsers>('GET', `${base}/active-users${qs({ f: common(args, ctx).f })}`)
      return { ...a, stickiness: a.mau ? a.dau / a.mau : null }
    },
  },
  {
    name: 'query_top',
    title: 'Top values',
    description: `Ranking of a field's values by events and users, e.g. top countries, channels, app versions or event names. Fields: ${FIELDS}.`,
    inputSchema: obj({ app: APP, by: str('Field to rank'), limit: num('Rows (default 10)', { minimum: 1, maximum: 100 }), range: RANGE, from: FROM, to: TO, filters: FILTERS, tz: TZ }, ['app', 'by']),
    annotations: { readOnlyHint: true },
    run: async (api, args, ctx) => {
      const { base } = await target(api, args)
      return api.request<TopResponse>('GET', `${base}/top${qs({ ...common(args, ctx), groupBy: need(args, 'by'), limit: n(args, 'limit') })}`)
    },
  },
  {
    name: 'query_trend',
    title: 'Trend',
    description: `Time series of a metric, optionally for one event and broken down by a field (top 8 groups). Metrics: events, users (unique), per_user, sum:<prop>, avg:<prop> (e.g. sum:amount for revenue). Breakdown fields: ${FIELDS}. The last bucket is the current, incomplete one.`,
    inputSchema: obj(
      {
        app: APP,
        event: str('Only this event (omit for all events)'),
        metric: str('events | users | per_user | sum:<prop> | avg:<prop>', { default: 'events' }),
        by: str('Breakdown field'),
        interval: str('Bucket size', { enum: ['hour', 'day'] }),
        range: RANGE,
        from: FROM,
        to: TO,
        filters: FILTERS,
        tz: TZ,
      },
      ['app'],
    ),
    annotations: { readOnlyHint: true },
    run: async (api, args, ctx) => {
      const { base } = await target(api, args)
      return api.request<InsightsResponse>('GET', `${base}/insights${qs({ ...common(args, ctx), event: s(args, 'event'), metric: s(args, 'metric'), groupBy: s(args, 'by') })}`)
    },
  },
  {
    name: 'query_funnel',
    title: 'Funnel',
    description: 'Ordered conversion through 2–8 events within a window: users per step, conversion from start and from the previous step, median time between steps; optional breakdown.',
    inputSchema: obj(
      {
        app: APP,
        steps: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8, description: 'Event names in order' },
        window_hours: num('Time allowed from the first step (default 168)', { minimum: 1, maximum: 2160 }),
        by: str('Breakdown field'),
        range: RANGE,
        from: FROM,
        to: TO,
        filters: FILTERS,
        tz: TZ,
      },
      ['app', 'steps'],
    ),
    annotations: { readOnlyHint: true },
    run: async (api, args, ctx) => {
      const { base } = await target(api, args)
      const steps = Array.isArray(args.steps) ? (args.steps as string[]) : []
      return api.request<FunnelResponse>('GET', `${base}/funnel${qs({ ...common(args, ctx), step: steps, window: n(args, 'window_hours'), groupBy: s(args, 'by') })}`)
    },
  },
  {
    name: 'query_errors',
    title: 'Errors',
    description: 'Error groups ($error events grouped by type, message and stack) with counts, affected users and last seen. Pass fingerprint for one group: trend, platform/version breakdown and recent stacks.',
    inputSchema: obj({ app: APP, fingerprint: str('Group id from a previous call'), range: RANGE, from: FROM, to: TO, filters: FILTERS, tz: TZ }, ['app']),
    annotations: { readOnlyHint: true },
    run: async (api, args, ctx) => {
      const { base } = await target(api, args)
      const fp = s(args, 'fingerprint')
      if (fp) {
        const d = await api.request<ErrorDetailResponse>('GET', `${base}/errors/${encodeURIComponent(fp)}${qs(common(args, ctx))}`)
        return { ...d, samples: d.samples.slice(0, 5) }
      }
      return api.request<ErrorsResponse>('GET', `${base}/errors${qs(common(args, ctx))}`)
    },
  },
  {
    name: 'query_events',
    title: 'Recent events',
    description: 'The most recent raw events (newest first), optionally for one event name. Useful to check what is arriving.',
    inputSchema: obj({ app: APP, name: str('Event name'), limit: num('Max events (default 20)', { minimum: 1, maximum: 200 }) }, ['app']),
    annotations: { readOnlyHint: true },
    run: async (api, args) => {
      const { base } = await target(api, args)
      return api.request<EventsResponse>('GET', `${base}/events${qs({ name: s(args, 'name'), limit: n(args, 'limit') ?? 20 })}`)
    },
  },
]

function normalizeProps(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ApiError(400, 'invalid_arguments', 'properties must be an array')
  return value.map((p: Json) => ({
    name: String(p.name ?? ''),
    type: (p.type as string) ?? 'any',
    required: p.required === true,
    description: typeof p.description === 'string' ? p.description : '',
  }))
}
