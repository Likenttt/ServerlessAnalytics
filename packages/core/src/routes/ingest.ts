import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { apiError, publicOrigin, readBody, type AppEnv } from '../http.js'
import { batchSchema, processBatch, type IncomingBatch } from '../ingest/process.js'
import { appForWriteKey, definitionsForApp } from '../services.js'
import type { IngestResponse } from '../types.js'

// Public ingestion API. Write keys are public (they ship inside apps), so
// CORS is open and the key can also travel in the body for sendBeacon().

export const ingestRoutes = new Hono<AppEnv>()

ingestRoutes.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['content-type', 'content-encoding', 'authorization', 'x-write-key'],
    maxAge: 86_400,
  }),
)

function writeKeyFrom(c: Context, body: { writeKey?: string }): string | undefined {
  const auth = c.req.header('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  return c.req.header('x-write-key') ?? body.writeKey ?? c.req.query('writeKey')
}

async function ingest(c: Context<AppEnv>, raw: unknown) {
  const services = c.get('services')
  const parsed = batchSchema.safeParse(raw)
  if (!parsed.success) {
    throw apiError(400, 'invalid_batch', parsed.error.issues[0]?.message ?? 'Invalid batch')
  }
  const batch: IncomingBatch = parsed.data
  if (batch.events.length > services.config.ingest.maxBatchSize) {
    throw apiError(413, 'batch_too_large', `A batch may contain at most ${services.config.ingest.maxBatchSize} events`)
  }

  const writeKey = writeKeyFrom(c, batch)
  if (!writeKey) throw apiError(401, 'missing_write_key', 'Provide the write key as a Bearer token, X-Write-Key header or writeKey field')
  const app = await appForWriteKey(services, writeKey)
  if (!app) throw apiError(401, 'invalid_write_key', 'Unknown write key')

  const definitions = app.schemaMode === 'strict' ? await definitionsForApp(services, app.id) : null
  const { rows, result } = processBatch(batch, app, definitions, {
    userAgent: c.req.header('user-agent') ?? null,
    country: normalizeCountry(c.req.header('cf-ipcountry') ?? c.req.header('x-vercel-ip-country')),
    acceptLanguage: c.req.header('accept-language') ?? null,
    receivedAt: Date.now(),
  })

  if (rows.length > 0) await services.queue.enqueue(rows, { origin: publicOrigin(c) })
  return c.json(result satisfies IngestResponse)
}

const normalizeCountry = (value: string | undefined) => (value && /^[A-Za-z]{2}$/.test(value) && value !== 'XX' ? value.toUpperCase() : null)

async function body(c: Context<AppEnv>) {
  // Accept any content type: sendBeacon() sends text/plain to avoid a CORS preflight.
  const text = await readBody(c.req.raw, c.get('services').config.ingest.maxBodyBytes)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw apiError(400, 'invalid_json', 'Request body must be valid JSON')
  }
}

ingestRoutes.post('/batch', async (c) => ingest(c, await body(c)))

/** Single-event convenience endpoint: the body is one event plus optional writeKey/context/sentAt. */
ingestRoutes.post('/track', async (c) => {
  const { writeKey, context, sentAt, ...event } = await body(c)
  return ingest(c, { writeKey, context, sentAt, events: [event] })
})

ingestRoutes.all('*', () => {
  throw apiError(404, 'not_found', 'Unknown ingestion endpoint')
})
