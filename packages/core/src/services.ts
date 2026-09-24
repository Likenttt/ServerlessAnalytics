import type { Kysely } from 'kysely'
import { resolveConfig, type Config } from './config.js'
import type { SqlDialect } from './db/dialect.js'
import { Repository } from './db/repository.js'
import type { Database } from './db/schema.js'
import { Cache, cacheKeys, createKV, type KVStore } from './kv.js'
import { createQueue, parseQueueMessage, type EventQueue } from './queue.js'
import type { App, EventDefinition } from './types.js'
import { TOKEN_PREFIX, hashToken, newAccessToken } from './tokens.js'
import { DAY, randomString } from './util.js'

export interface OpenDatabase {
  db: Kysely<Database>
  dialect: SqlDialect
  /** Called once the request (or batch) is finished. */
  close?: () => Promise<void>
}

/** What a platform entry (Cloudflare, Vercel, …) provides. */
export interface Platform {
  runtime: string
  env: Record<string, unknown>
  waitUntil(promise: Promise<unknown>): void
  openDatabase(config: Config): OpenDatabase | Promise<OpenDatabase>
}

export interface Services {
  runtime: string
  config: Config
  repo: Repository
  kv: KVStore
  cache: Cache
  queue: EventQueue
  waitUntil(promise: Promise<unknown>): void
  /** Waits for background work, then closes the database connection. */
  close(): Promise<void>
  /** Schedules close() without blocking the response. */
  release(): void
}

export async function createServices(platform: Platform): Promise<Services> {
  const config = resolveConfig(platform.env)
  const database = await platform.openDatabase(config)
  const repo = new Repository(database.db, database.dialect)
  const kv = createKV(config, platform.env)
  // Track background work so the database is only closed after it settles.
  const pending: Promise<unknown>[] = []
  const waitUntil = (promise: Promise<unknown>) => {
    pending.push(promise)
    platform.waitUntil(promise)
  }
  const close = async () => {
    while (pending.length > 0) await Promise.allSettled(pending.splice(0))
    await database.close?.()
  }
  return {
    runtime: platform.runtime,
    config,
    repo,
    kv,
    cache: new Cache(kv, waitUntil),
    queue: createQueue(config, { env: platform.env, write: (rows) => repo.insertEvents(rows), waitUntil }),
    waitUntil,
    close,
    // Not through waitUntil() above: close() awaits everything tracked there.
    release: () => platform.waitUntil(close().catch((error) => console.error('[close]', error))),
  }
}

const APP_TTL = 300

/** Resolves a write key through the cache. Unknown keys are cached too (as null). */
export function appForWriteKey(services: Services, writeKey: string): Promise<App | null> {
  return services.cache.get(cacheKeys.appByWriteKey(writeKey), APP_TTL, () => services.repo.getAppByWriteKey(writeKey))
}

export function definitionsForApp(services: Services, appId: string): Promise<EventDefinition[]> {
  return services.cache.get(cacheKeys.definitions(appId), APP_TTL, () => services.repo.listDefinitions(appId))
}

export async function invalidateApp(services: Services, app: Pick<App, 'id' | 'writeKey'>) {
  await services.cache.invalidate(cacheKeys.appByWriteKey(app.writeKey), cacheKeys.definitions(app.id))
}

/** Creates a personal access token; the secret is returned once and never stored. */
export async function issueToken(repo: Repository, name: string) {
  const token = newAccessToken()
  const record = await repo.createToken({
    id: randomString(12, '0123456789abcdefghijklmnopqrstuvwxyz'),
    name,
    tokenHash: await hashToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 4),
  })
  return { token, record }
}

/** Consumer for queued messages (Cloudflare Queues, QStash). */
export async function consumeQueueBodies(services: Services, bodies: unknown[]): Promise<number> {
  const rows = bodies.flatMap((body) => parseQueueMessage(body).rows)
  return services.repo.insertEvents(rows)
}

/**
 * Deletes events past each app's retention window and purges apps that were
 * deleted, in chunks, until done or the time budget runs out. Safe to run
 * repeatedly (cron).
 */
export async function runRetention(services: Services, budgetMs = 20_000): Promise<{ deleted: number; complete: boolean }> {
  const started = Date.now()
  const outOfTime = () => Date.now() - started > budgetMs
  let deleted = 0
  for (const app of await services.repo.listApps({ includeDeleted: true })) {
    const cutoff = app.deletedAt ? Number.MAX_SAFE_INTEGER : Date.now() - app.retentionDays * DAY
    for (;;) {
      if (outOfTime()) return { deleted, complete: false }
      const n = await services.repo.deleteEventsBefore(app.id, cutoff, 5000)
      deleted += n
      if (n < 5000) break
    }
    if (app.deletedAt) await services.repo.hardDeleteApp(app.id)
  }
  return { deleted, complete: true }
}
