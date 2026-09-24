import { z } from 'zod'
import type { EventRow } from '../db/schema.js'
import type { App, EventDefinition, IngestResponse } from '../types.js'
import { randomString } from '../util.js'
import { EVENT_NAME, MAX_PROPERTIES, MAX_PROPERTIES_BYTES, PROPERTY_KEY } from '../validation.js'
import { parseUserAgent } from './ua.js'

// Wire format: see docs/HTTP_API.md.

const timestamp = z.union([z.number().finite(), z.string().max(64)])
const text = (max = 128) => z.string().max(max).nullish()

const contextSchema = z.object({
  platform: text(32),
  os: text(),
  osVersion: text(),
  browser: text(),
  appVersion: text(),
  device: text(),
  locale: text(35),
  country: text(2),
  region: text(8),
  channel: text(64),
})

const eventSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().regex(EVENT_NAME, 'invalid event name'),
  timestamp: timestamp.optional(),
  anonymousId: z.string().min(1).max(256).nullish(),
  userId: z.string().min(1).max(256).nullish(),
  distinctId: z.string().min(1).max(256).nullish(),
  sessionId: z.string().min(1).max(256).nullish(),
  properties: z.record(z.string(), z.unknown()).nullish(),
  context: contextSchema.nullish(),
})

export const batchSchema = z.object({
  writeKey: z.string().max(128).optional(),
  sentAt: timestamp.optional(),
  context: contextSchema.nullish(),
  events: z.array(z.unknown()).min(1),
})

export type IncomingBatch = z.infer<typeof batchSchema>
type IncomingEvent = z.infer<typeof eventSchema>
type Context = z.infer<typeof contextSchema>

export interface RequestInfo {
  userAgent: string | null
  country: string | null
  region: string | null
  acceptLanguage: string | null
  receivedAt: number
}

const MAX_FUTURE_MS = 60_000
const MAX_AGE_MS = 400 * 86_400_000

function parseTimestamp(value: number | string | undefined): number | null {
  if (value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function checkProperties(props: Record<string, unknown>): string | null {
  const keys = Object.keys(props)
  if (keys.length > MAX_PROPERTIES) return `too many properties (max ${MAX_PROPERTIES})`
  const bad = keys.find((k) => !PROPERTY_KEY.test(k))
  if (bad !== undefined) return `invalid property key "${bad.slice(0, 64)}"`
  if (JSON.stringify(props).length > MAX_PROPERTIES_BYTES) return `properties exceed ${MAX_PROPERTIES_BYTES} bytes`
  return null
}

function checkDefinition(event: IncomingEvent, def: EventDefinition | undefined): string | null {
  if (!def) return `event "${event.name}" is not defined (app is in strict mode)`
  if (def.status === 'archived') return `event "${event.name}" is archived`
  const props = event.properties ?? {}
  for (const p of def.properties) {
    const value = props[p.name]
    if (value === undefined || value === null) {
      if (p.required) return `missing required property "${p.name}"`
      continue
    }
    if (p.type !== 'any' && typeof value !== p.type) return `property "${p.name}" must be a ${p.type}`
  }
  return null
}

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0]
  if (!issue) return 'invalid event'
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message
}

const clean = (v: string | null | undefined) => (v == null || v === '' ? null : v)

/** First language tag of an Accept-Language header, ignoring wildcards. */
function localeFrom(header: string | null): string | null {
  const tag = header?.split(',')[0]?.split(';')[0]?.trim()
  return tag && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : null
}

/**
 * Validates and enriches a batch. Never throws for individual bad events —
 * they are reported in `rejected` so clients don't retry them forever.
 */
export function processBatch(
  batch: IncomingBatch,
  app: App,
  definitions: EventDefinition[] | null,
  info: RequestInfo,
): { rows: EventRow[]; result: IngestResponse } {
  const rejected: IngestResponse['rejected'] = []
  const rows: EventRow[] = []
  const sentAt = parseTimestamp(batch.sentAt)
  const skew = sentAt !== null ? info.receivedAt - sentAt : 0
  const ua = parseUserAgent(info.userAgent)
  const defs = definitions ? new Map(definitions.map((d) => [d.name, d])) : null
  const seen = new Set<string>()

  batch.events.forEach((raw, index) => {
    const parsed = eventSchema.safeParse(raw)
    const rawId = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : undefined
    if (!parsed.success) {
      rejected.push({ index, id: rawId, reason: firstIssue(parsed.error) })
      return
    }
    const event = parsed.data

    const distinctId = event.userId ?? event.distinctId ?? event.anonymousId
    if (!distinctId) {
      rejected.push({ index, id: event.id, reason: 'one of anonymousId, userId or distinctId is required' })
      return
    }

    const properties = event.properties ?? {}
    const propError = checkProperties(properties)
    if (propError) {
      rejected.push({ index, id: event.id, reason: propError })
      return
    }

    if (defs) {
      const defError = checkDefinition(event, defs.get(event.name))
      if (defError) {
        rejected.push({ index, id: event.id, reason: defError })
        return
      }
    }

    let ts = parseTimestamp(event.timestamp)
    if (event.timestamp !== undefined && ts === null) {
      rejected.push({ index, id: event.id, reason: 'invalid timestamp' })
      return
    }
    ts = ts === null ? info.receivedAt : ts + skew
    if (ts > info.receivedAt + MAX_FUTURE_MS) ts = info.receivedAt
    if (ts < info.receivedAt - MAX_AGE_MS) {
      rejected.push({ index, id: event.id, reason: 'timestamp is too old' })
      return
    }

    const id = event.id ?? `srv_${info.receivedAt.toString(36)}${randomString(12)}`
    if (seen.has(id)) return
    seen.add(id)

    const ctx: Context = { ...batch.context, ...event.context }
    const platform = clean(ctx.platform)?.toLowerCase() ?? (ua.isBrowser ? 'web' : null)
    const useUA = platform === 'web' || platform === null
    rows.push({
      app_id: app.id,
      id,
      name: event.name,
      ts,
      received_at: info.receivedAt,
      distinct_id: distinctId,
      user_id: event.userId ?? null,
      session_id: event.sessionId ?? null,
      platform,
      os: clean(ctx.os) ?? (useUA ? ua.os : null),
      os_version: clean(ctx.osVersion) ?? (useUA ? ua.osVersion : null),
      browser: clean(ctx.browser) ?? (useUA ? ua.browser : null),
      app_version: clean(ctx.appVersion),
      device: clean(ctx.device) ?? (useUA ? ua.device : null),
      country: clean(ctx.country)?.toUpperCase() ?? info.country,
      locale: clean(ctx.locale) ?? localeFrom(info.acceptLanguage),
      channel: clean(ctx.channel)?.toLowerCase() ?? null,
      // Only use the request's region when the country also came from the request.
      region: clean(ctx.region)?.toUpperCase() ?? (clean(ctx.country) ? null : info.region),
      properties,
    })
  })

  return { rows, result: { ok: true, accepted: rows.length, rejected } }
}
