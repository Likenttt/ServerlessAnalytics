import { getRequestListener } from '@hono/node-server'
import { attachDatabasePool, waitUntil } from '@vercel/functions'
import { ConfigError, createApp, createServices, type Config, type OpenDatabase } from '@serverless-analytics/core'
import { createPostgresDatabase } from '@serverless-analytics/core/postgres'

// One Vercel Function (Node.js runtime) serves /api/* and /v1/*. The pool is
// module-level so warm instances reuse connections; attachDatabasePool lets
// Fluid compute release idle clients before the instance is suspended.

let database: OpenDatabase | undefined

function openDatabase(config: Config): OpenDatabase {
  if (config.database.driver !== 'postgres') {
    throw new ConfigError(['On Vercel set DATABASE_URL (Postgres/Supabase). D1 is only reachable from Cloudflare Workers.'])
  }
  if (!database) {
    const { db, pool, dialect } = createPostgresDatabase(config.database.url, { max: 5 })
    attachDatabasePool(pool)
    database = { db, dialect }
  }
  return database
}

const env = process.env as Record<string, unknown>

const app = createApp({
  services: () => createServices({ runtime: 'vercel', env, waitUntil, openDatabase }),
  env: () => env,
})

export default getRequestListener(app.fetch)
