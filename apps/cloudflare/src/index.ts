import { consumeQueueBodies, createApp, createServices, runRetention, type Config, type OpenDatabase, type Platform } from '@serverless-analytics/core'
import { createD1Database } from '@serverless-analytics/core/d1'

type Env = Record<string, unknown> & { DB?: D1Database }

async function openDatabase(config: Config, env: Env): Promise<OpenDatabase> {
  if (config.database.driver === 'd1') return createD1Database(env.DB!)
  // Loaded lazily so D1 deployments never evaluate the pg driver. Connections
  // can't be shared across requests in Workers; Hyperdrive does the pooling.
  const { createPostgresDatabase } = await import('@serverless-analytics/core/postgres')
  const { db, dialect } = createPostgresDatabase(config.database.url, { max: 1 })
  return { db, dialect, close: () => db.destroy() }
}

const platform = (env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Platform => ({
  runtime: 'cloudflare',
  env,
  waitUntil: (promise) => ctx.waitUntil(promise),
  openDatabase: (config) => openDatabase(config, env),
})

const app = createApp({
  services: (c) => createServices(platform(c.env as Env, c.executionCtx)),
  env: (c) => c.env as Env,
})

export default {
  fetch: app.fetch,

  // Consumer for QUEUE_DRIVER=cloudflare: one database write per delivered batch.
  async queue(batch, env, ctx) {
    const services = await createServices(platform(env, ctx))
    try {
      await consumeQueueBodies(services, batch.messages.map((m) => m.body))
      batch.ackAll()
    } catch (error) {
      console.error('[queue] batch failed, retrying', error)
      batch.retryAll({ delaySeconds: 10 })
    } finally {
      await services.close()
    }
  },

  async scheduled(_controller, env, ctx) {
    const services = await createServices(platform(env, ctx))
    try {
      console.log('[retention]', await runRetention(services))
    } finally {
      await services.close()
    }
  },
} satisfies ExportedHandler<Env>
