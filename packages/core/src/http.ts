import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Services } from './services.js'
import type { ApiError, Interval, TimeRange } from './types.js'
import { DAY, HOUR, trailingRange } from './util.js'
import { parseGroupBy } from './validation.js'
import type { Filter } from './db/repository.js'

export type AppEnv = { Variables: { services: Services } }

export function apiError(status: ContentfulStatusCode, code: string, message: string): HTTPException {
  const body: ApiError = { error: { code, message } }
  return new HTTPException(status, { res: Response.json(body, { status }) })
}

/**
 * The origin the browser sees. Behind TLS-terminating proxies (Vercel's Node
 * runtime) the request URL is http://, so honor X-Forwarded-Proto/Host.
 */
export function publicOrigin(c: Context): string {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim()
  return `${proto === 'https' || proto === 'http' ? proto : url.protocol.slice(0, -1)}://${host || url.host}`
}

/** Reads a request body with a size cap, transparently handling gzip. */
export async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw apiError(413, 'payload_too_large', `Body exceeds ${maxBytes} bytes`)
  if (!request.body) return ''
  let stream = request.body as ReadableStream<Uint8Array>
  const encoding = request.headers.get('content-encoding')?.toLowerCase()
  if (encoding === 'gzip' || encoding === 'deflate') {
    stream = stream.pipeThrough(new DecompressionStream(encoding) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw apiError(413, 'payload_too_large', `Body exceeds ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function readJson(c: Context, maxBytes = 100_000): Promise<unknown> {
  const text = await readBody(c.req.raw, maxBytes)
  try {
    return JSON.parse(text)
  } catch {
    throw apiError(400, 'invalid_json', 'Request body must be valid JSON')
  }
}

const RANGES: Record<string, { count: number; interval: Interval }> = {
  '24h': { count: 24, interval: 'hour' },
  '7d': { count: 7, interval: 'day' },
  '30d': { count: 30, interval: 'day' },
  '90d': { count: 90, interval: 'day' },
}

export function parseRange(c: Context): TimeRange {
  const tzRaw = Number(c.req.query('tz') ?? 0)
  const tzOffset = Number.isInteger(tzRaw) && Math.abs(tzRaw) <= 840 ? tzRaw : 0
  const from = Number(c.req.query('from'))
  const to = Number(c.req.query('to'))
  const requested = c.req.query('interval')

  if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from) {
    if (to - from > 400 * DAY) throw apiError(400, 'invalid_range', 'Range must be at most 400 days')
    const span = to - from
    const hourly = requested === 'hour' ? span <= 7 * DAY : requested !== 'day' && span <= 2 * DAY
    return { from, to, interval: hourly ? 'hour' : 'day', tzOffset }
  }

  const preset = RANGES[c.req.query('range') ?? '7d'] ?? RANGES['7d']!
  if (requested === 'hour' && preset.interval === 'day' && preset.count <= 7) {
    return trailingRange(Date.now(), (preset.count * DAY) / HOUR, 'hour', tzOffset)
  }
  return trailingRange(Date.now(), preset.count, preset.interval, tzOffset)
}

/** `f=<groupBy>=<value>` query parameters, e.g. `f=platform=ios&f=prop:plan=pro`. */
export function parseFilters(c: Context): Filter[] {
  const filters: Filter[] = []
  for (const raw of c.req.queries('f') ?? []) {
    const i = raw.indexOf('=')
    if (i <= 0) continue
    const by = parseGroupBy(raw.slice(0, i))
    if (by) filters.push({ by, value: raw.slice(i + 1) })
  }
  return filters.slice(0, 10)
}

export function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}
