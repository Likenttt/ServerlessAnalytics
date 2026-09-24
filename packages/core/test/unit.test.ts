import { describe, expect, it } from 'vitest'
import { ConfigError, resolveConfig } from '../src/config.js'
import { processBatch } from '../src/ingest/process.js'
import { parseUserAgent } from '../src/ingest/ua.js'
import { chunkBySize, verifyQstashSignature } from '../src/queue.js'
import type { App } from '../src/types.js'
import { base64url, hmacSha256, sha256 } from '../src/util.js'

const binding = {}

describe('resolveConfig', () => {
  it('infers drivers from available bindings', () => {
    const config = resolveConfig({ ADMIN_PASSWORD: 'password1', DB: binding, KV: binding })
    expect(config.database).toEqual({ driver: 'd1' })
    expect(config.kv).toEqual({ driver: 'cloudflare' })
    expect(config.queue).toEqual({ driver: 'direct' })
  })

  it('supports postgres + upstash (e.g. Vercel + Supabase)', () => {
    const config = resolveConfig({
      ADMIN_PASSWORD: 'password1',
      DATABASE_URL: 'postgres://u:p@db.supabase.co:6543/postgres',
      KV_REST_API_URL: 'https://x.upstash.io',
      KV_REST_API_TOKEN: 'tok',
    })
    expect(config.database).toEqual({ driver: 'postgres', url: 'postgres://u:p@db.supabase.co:6543/postgres' })
    expect(config.kv).toMatchObject({ driver: 'upstash', url: 'https://x.upstash.io' })
  })

  it('prefers a Hyperdrive binding for postgres on Cloudflare', () => {
    const config = resolveConfig({ ADMIN_PASSWORD: 'password1', DB_DRIVER: 'postgres', HYPERDRIVE: { connectionString: 'postgres://hd' } })
    expect(config.database).toEqual({ driver: 'postgres', url: 'postgres://hd' })
  })

  it('lists every problem at once', () => {
    try {
      resolveConfig({ DB_DRIVER: 'mysql', QUEUE_DRIVER: 'cloudflare', KV_DRIVER: 'upstash' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const problems = (error as ConfigError).problems
      expect(problems).toEqual([
        'DB_DRIVER must be one of d1, postgres (got "mysql")',
        'DB_DRIVER=d1 requires a D1 binding named "DB"',
        'KV_DRIVER=upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
        'QUEUE_DRIVER=cloudflare requires a Queue producer binding named "EVENTS_QUEUE"',
        'ADMIN_PASSWORD is required',
      ])
    }
  })
})

describe('verifyQstashSignature', () => {
  const keys = { currentSigningKey: 'sig_current', nextSigningKey: 'sig_next' }
  const sign = async (key: string, claims: object) => {
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)))
    return `${header}.${payload}.${base64url(await hmacSha256(key, `${header}.${payload}`))}`
  }

  it('accepts valid signatures from either key and checks the body hash', async () => {
    const body = '{"v":1,"rows":[]}'
    const now = Date.now()
    const claims = { iss: 'Upstash', exp: Math.floor(now / 1000) + 300, nbf: Math.floor(now / 1000), body: base64url(await sha256(body)) }
    expect(await verifyQstashSignature(await sign('sig_current', claims), body, keys)).toBe(true)
    expect(await verifyQstashSignature(await sign('sig_next', claims), body, keys)).toBe(true)
    expect(await verifyQstashSignature(await sign('other', claims), body, keys)).toBe(false)
    expect(await verifyQstashSignature(await sign('sig_current', claims), body + ' ', keys)).toBe(false)
    expect(await verifyQstashSignature(await sign('sig_current', { ...claims, exp: 1 }), body, keys)).toBe(false)
    expect(await verifyQstashSignature(undefined, body, keys)).toBe(false)
  })
})

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      { os: 'macOS', browser: 'Chrome', device: 'Desktop' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      { os: 'Windows', osVersion: '10', browser: 'Edge' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      { os: 'Android', osVersion: '14', device: 'Mobile' },
    ],
    ['okhttp/4.12.0', { os: null, browser: null, isBrowser: false }],
  ])('%s', (ua, expected) => {
    expect(parseUserAgent(ua)).toMatchObject(expected)
  })
})

describe('processBatch', () => {
  const app: App = { id: 'app', name: 'A', writeKey: 'wk', schemaMode: 'permissive', retentionDays: 30, createdAt: 0, updatedAt: 0 }
  const info = { userAgent: null, country: 'FR', acceptLanguage: 'fr-FR,fr;q=0.9', receivedAt: 1_000_000_000_000 }

  it('corrects client clock skew using sentAt', () => {
    // Device clock is 1 hour behind.
    const { rows } = processBatch(
      { sentAt: info.receivedAt - 3_600_000, events: [{ name: 'e', anonymousId: 'a', timestamp: info.receivedAt - 3_600_000 - 5000 }] },
      app,
      null,
      info,
    )
    expect(rows[0]!.ts).toBe(info.receivedAt - 5000)
    expect(rows[0]).toMatchObject({ country: 'FR', locale: 'fr-FR', distinct_id: 'a' })
  })

  it('clamps future timestamps, dedupes ids and prefers userId', () => {
    const { rows } = processBatch(
      {
        events: [
          { id: 'x', name: 'e', anonymousId: 'a', userId: 'u', timestamp: info.receivedAt + 86_400_000 },
          { id: 'x', name: 'e', anonymousId: 'a' },
        ],
      },
      app,
      null,
      info,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ts: info.receivedAt, distinct_id: 'u', user_id: 'u' })
  })

  it('rejects invalid property keys and oversized properties', () => {
    const { result } = processBatch(
      {
        events: [
          { name: 'e', anonymousId: 'a', properties: { 'bad key': 1 } },
          { name: 'e', anonymousId: 'a', properties: { big: 'x'.repeat(20_000) } },
        ],
      },
      app,
      null,
      info,
    )
    expect(result.rejected.map((r) => r.reason)).toEqual(['invalid property key "bad key"', 'properties exceed 16384 bytes'])
  })
})

describe('chunkBySize', () => {
  it('splits rows so each chunk stays under the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), properties: { pad: 'x'.repeat(300) } }) as never)
    const chunks = chunkBySize(rows, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toHaveLength(10)
    for (const chunk of chunks) expect(JSON.stringify(chunk).length).toBeLessThan(1000)
  })
})
