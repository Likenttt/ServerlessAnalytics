import { BINDINGS, type Config, type QueueDriver } from './config.js'
import type { EventRow } from './db/schema.js'
import { base64url, base64urlDecode, hmacSha256, safeEqual, sha256 } from './util.js'

/**
 * How accepted events get from the ingest endpoint into the database.
 *
 * - direct:     write inside the request. Simplest and durable; the client
 *               gets 200 only after the write committed.
 * - background: respond immediately, write via waitUntil(). Lowest latency,
 *               but events are lost if the write fails.
 * - cloudflare: Cloudflare Queues. The consumer writes batches (fewer, larger
 *               D1 writes) with retries and an optional dead-letter queue.
 * - qstash:     Upstash QStash. Works anywhere (e.g. Vercel); QStash calls back
 *               /api/queue/qstash with retries.
 */
export interface EventQueue {
  readonly driver: QueueDriver
  enqueue(rows: EventRow[], ctx: { origin: string }): Promise<void>
}

export interface QueueMessage {
  v: 1
  rows: EventRow[]
}

export type EventWriter = (rows: EventRow[]) => Promise<number>

interface CloudflareQueueLike {
  sendBatch(messages: { body: unknown; contentType?: 'json' }[]): Promise<void>
}

/** Split rows into messages whose JSON stays under `maxBytes`. */
export function chunkBySize(rows: EventRow[], maxBytes: number): EventRow[][] {
  const chunks: EventRow[][] = []
  let current: EventRow[] = []
  let size = 32
  for (const row of rows) {
    const rowSize = new TextEncoder().encode(JSON.stringify(row)).length + 1
    if (current.length > 0 && size + rowSize > maxBytes) {
      chunks.push(current)
      current = []
      size = 32
    }
    current.push(row)
    size += rowSize
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function createQueue(
  config: Config,
  deps: { env: Record<string, unknown>; write: EventWriter; waitUntil: (promise: Promise<unknown>) => void },
): EventQueue {
  const q = config.queue
  switch (q.driver) {
    case 'direct':
      return {
        driver: 'direct',
        enqueue: async (rows) => {
          await deps.write(rows)
        },
      }
    case 'background':
      return {
        driver: 'background',
        enqueue: async (rows) => {
          deps.waitUntil(deps.write(rows).catch((error) => console.error('[queue:background] write failed', error)))
        },
      }
    case 'cloudflare': {
      const queue = deps.env[BINDINGS.queue] as CloudflareQueueLike
      return {
        driver: 'cloudflare',
        enqueue: async (rows) => {
          // Messages are limited to 128 KB and sendBatch to 256 KB / 100 messages.
          const messages = chunkBySize(rows, 100_000).map((chunk) => ({ body: { v: 1, rows: chunk } satisfies QueueMessage }))
          let batch: typeof messages = []
          let batchBytes = 0
          for (const message of messages) {
            const bytes = JSON.stringify(message.body).length
            if (batch.length > 0 && (batchBytes + bytes > 240_000 || batch.length === 100)) {
              await queue.sendBatch(batch)
              batch = []
              batchBytes = 0
            }
            batch.push(message)
            batchBytes += bytes
          }
          if (batch.length > 0) await queue.sendBatch(batch)
        },
      }
    }
    case 'qstash':
      return {
        driver: 'qstash',
        enqueue: async (rows, ctx) => {
          const callback = `${q.publicUrl ?? ctx.origin}/api/queue/qstash`
          for (const chunk of chunkBySize(rows, 500_000)) {
            const res = await fetch(`${q.baseUrl}/v2/publish/${callback}`, {
              method: 'POST',
              headers: { authorization: `Bearer ${q.token}`, 'content-type': 'application/json' },
              body: JSON.stringify({ v: 1, rows: chunk } satisfies QueueMessage),
            })
            if (!res.ok) throw new Error(`QStash publish failed: ${res.status} ${await res.text().catch(() => '')}`)
          }
        },
      }
  }
}

export function parseQueueMessage(body: unknown): QueueMessage {
  const msg = body as QueueMessage
  if (!msg || msg.v !== 1 || !Array.isArray(msg.rows)) throw new Error('Unrecognized queue message')
  return msg
}

/**
 * Verifies the `Upstash-Signature` JWT (HS256) QStash attaches to deliveries:
 * signature with the current or next signing key, issuer, time window and the
 * SHA-256 of the raw body.
 */
export async function verifyQstashSignature(
  signature: string | undefined,
  body: string,
  keys: { currentSigningKey: string; nextSigningKey: string },
  now = Date.now(),
): Promise<boolean> {
  if (!signature) return false
  const parts = signature.split('.')
  if (parts.length !== 3) return false
  const [header, payload, sig] = parts as [string, string, string]

  let valid = false
  for (const key of [keys.currentSigningKey, keys.nextSigningKey]) {
    if (safeEqual(base64url(await hmacSha256(key, `${header}.${payload}`)), sig)) valid = true
  }
  if (!valid) return false

  let claims: { iss?: string; exp?: number; nbf?: number; body?: string }
  try {
    claims = JSON.parse(base64urlDecode(payload))
  } catch {
    return false
  }
  const seconds = Math.floor(now / 1000)
  const skew = 60
  if (claims.iss !== 'Upstash') return false
  if (typeof claims.exp === 'number' && claims.exp + skew < seconds) return false
  if (typeof claims.nbf === 'number' && claims.nbf - skew > seconds) return false
  const expected = base64url(await sha256(body))
  return typeof claims.body === 'string' && safeEqual(claims.body.replace(/=+$/, ''), expected)
}
