import { BINDINGS, type Config } from './config.js'

/**
 * KV is used only as a cache (write key → app, event definitions) and for
 * best-effort counters (login throttling). Cloudflare KV is eventually
 * consistent and allows ~1 write/sec per key, so nothing here needs strong
 * consistency. The database stays the source of truth.
 */
export interface KVStore {
  readonly driver: string
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

/** Structural subset of Cloudflare's KVNamespace. */
interface KVNamespaceLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

const PREFIX = 'sa:'

export function cloudflareKV(ns: KVNamespaceLike): KVStore {
  return {
    driver: 'cloudflare',
    get: (key) => ns.get(PREFIX + key),
    // Cloudflare KV rejects TTLs below 60 seconds.
    set: (key, value, ttl) => ns.put(PREFIX + key, value, { expirationTtl: Math.max(60, Math.ceil(ttl)) }),
    delete: (key) => ns.delete(PREFIX + key),
  }
}

export function upstashKV(url: string, token: string, fetchImpl: typeof fetch = fetch): KVStore {
  const endpoint = url.replace(/\/+$/, '')
  const command = async (args: (string | number)[]) => {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string }
    if (!res.ok || body.error) throw new Error(`Upstash ${args[0]} failed: ${body.error ?? res.status}`)
    return body.result
  }
  return {
    driver: 'upstash',
    get: async (key) => {
      const result = await command(['GET', PREFIX + key])
      return typeof result === 'string' ? result : null
    },
    set: async (key, value, ttl) => {
      await command(['SET', PREFIX + key, value, 'EX', Math.max(1, Math.ceil(ttl))])
    },
    delete: async (key) => {
      await command(['DEL', PREFIX + key])
    },
  }
}

export function memoryKV(): KVStore {
  const store = new Map<string, { value: string; expires: number }>()
  return {
    driver: 'memory',
    get: async (key) => {
      const hit = store.get(key)
      if (!hit) return null
      if (hit.expires < Date.now()) {
        store.delete(key)
        return null
      }
      return hit.value
    },
    set: async (key, value, ttl) => {
      if (store.size > 5000) store.clear()
      store.set(key, { value, expires: Date.now() + ttl * 1000 })
    },
    delete: async (key) => {
      store.delete(key)
    },
  }
}

// Per-isolate state survives across requests in the same instance.
const sharedMemoryKV = memoryKV()
const l1 = new Map<string, { value: unknown; expires: number }>()
const L1_TTL_MS = 30_000

export function createKV(config: Config, env: Record<string, unknown>): KVStore {
  switch (config.kv.driver) {
    case 'cloudflare':
      return cloudflareKV(env[BINDINGS.kv] as KVNamespaceLike)
    case 'upstash':
      return upstashKV(config.kv.url, config.kv.token)
    case 'memory':
      return sharedMemoryKV
  }
}

/**
 * Two-level read-through cache: an in-memory L1 per instance (30s) in front of
 * the configured KV (L2). Invalidation clears L2 and the local L1; other
 * instances pick up the change within L1_TTL_MS.
 */
export class Cache {
  constructor(
    private readonly kv: KVStore,
    private readonly waitUntil: (promise: Promise<unknown>) => void = () => {},
  ) {}

  async get<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const local = l1.get(key)
    if (local && local.expires > now) return local.value as T

    let value: T | undefined
    try {
      const raw = await this.kv.get(key)
      if (raw !== null) value = JSON.parse(raw) as T
    } catch (error) {
      console.warn(`[cache] KV read failed for ${key}:`, error)
    }
    if (value === undefined) {
      value = await load()
      this.waitUntil(
        this.kv.set(key, JSON.stringify(value), ttlSeconds).catch((error) => console.warn(`[cache] KV write failed for ${key}:`, error)),
      )
    }
    if (l1.size > 1000) l1.clear()
    l1.set(key, { value, expires: now + Math.min(L1_TTL_MS, ttlSeconds * 1000) })
    return value
  }

  async invalidate(...keys: string[]): Promise<void> {
    for (const key of keys) l1.delete(key)
    await Promise.all(keys.map((key) => this.kv.delete(key).catch(() => {})))
  }
}

export const cacheKeys = {
  appByWriteKey: (writeKey: string) => `app:wk:${writeKey}`,
  definitions: (appId: string) => `defs:${appId}`,
}
