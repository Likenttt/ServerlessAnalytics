import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, verifySessionToken } from './auth.js'
import { ConfigError, resolveConfig } from './config.js'
import type { AppEnv } from './http.js'
import { adminRoutes } from './routes/admin.js'
import { cliRoutes } from './routes/cli.js'
import { mountMcp } from './routes/mcp.js'
import { ingestRoutes } from './routes/ingest.js'
import { internalRoutes } from './routes/internal.js'
import type { Services } from './services.js'
import type { ApiError, SessionResponse } from './types.js'

export interface CreateAppOptions {
  /** Builds the per-request services for the current platform. */
  services(c: Context): Promise<Services>
  /** Raw environment, used to report configuration problems before login. */
  env(c: Context): Record<string, unknown>
}

/**
 * The whole HTTP surface, independent of the hosting platform:
 *   /v1/*   public ingestion (write key)
 *   /api/*  dashboard API (session cookie), QStash callback, cron
 * Everything else is the static dashboard, served by the platform.
 */
export function createApp(options: CreateAppOptions) {
  const app = new Hono<AppEnv>()

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    if (error instanceof ConfigError) {
      console.error(error.message)
      return c.json<ApiError>({ error: { code: 'config_error', message: error.message } }, 500)
    }
    console.error('[error]', error)
    return c.json<ApiError>({ error: { code: 'internal_error', message: 'Internal server error' } }, 500)
  })

  app.notFound((c) => c.json<ApiError>({ error: { code: 'not_found', message: 'Not found' } }, 404))

  app.get('/api/health', (c) => c.json({ ok: true }))

  // Works even when the configuration is broken, so the dashboard can explain what's wrong.
  app.get('/api/auth/session', async (c) => {
    try {
      const config = resolveConfig(options.env(c))
      const authenticated = await verifySessionToken(config.auth.sessionSecret, getCookie(c, SESSION_COOKIE))
      return c.json<SessionResponse>({ authenticated })
    } catch (error) {
      if (error instanceof ConfigError) return c.json<SessionResponse>({ authenticated: false, configError: error.message })
      throw error
    }
  })

  const withServices: MiddlewareHandler<AppEnv> = async (c, next) => {
    const services = await options.services(c)
    c.set('services', services)
    try {
      await next()
    } finally {
      services.release()
    }
  }

  app.use('/v1/*', withServices)
  app.use('/api/*', withServices)
  app.use('/mcp', withServices)
  app.route('/v1', ingestRoutes)
  app.route('/api', internalRoutes)
  app.route('/api', cliRoutes)
  app.route('/api', adminRoutes)
  mountMcp(app)

  return app
}
