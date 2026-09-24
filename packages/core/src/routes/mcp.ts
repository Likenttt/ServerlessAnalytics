import { handlePayload, parseError, readResponse, type Api } from '@serverless-analytics/mcp'
import type { Hono } from 'hono'
import { publicOrigin, readBody, type AppEnv } from '../http.js'
import { requireSession } from './session.js'

/**
 * Remote MCP server (Streamable HTTP, stateless JSON responses) at /mcp.
 * Authenticate with `Authorization: Bearer <access token>`. Tools call the
 * dashboard API in-process with the same credentials, so every check applies.
 */
export function mountMcp(app: Hono<AppEnv>) {
  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json({ error: { code: 'method_not_allowed', message: 'This MCP server is stateless: POST JSON-RPC messages to /mcp.' } }, 405, { allow: 'POST' }),
  )

  app.post(
    '/mcp',
    async (c, next) => {
      // Tell MCP clients how to authenticate before the generic 401.
      if (!c.req.header('authorization') && !c.req.header('cookie')) {
        return c.json(
          { error: { code: 'unauthorized', message: 'Send Authorization: Bearer <access token> (Settings → Access tokens, or sa login).' } },
          401,
          { 'www-authenticate': 'Bearer realm="serverless-analytics", error="invalid_token"' },
        )
      }
      await next()
    },
    requireSession,
    async (c) => {
      let payload: unknown
      try {
        payload = JSON.parse(await readBody(c.req.raw, 1_000_000))
      } catch {
        return c.json(parseError(), 400)
      }
      const origin = publicOrigin(c)
      const forward: Record<string, string> = {}
      for (const name of ['authorization', 'cookie', 'x-forwarded-proto', 'x-forwarded-host']) {
        const value = c.req.header(name)
        if (value) forward[name] = value
      }
      let executionCtx: typeof c.executionCtx | undefined
      try {
        executionCtx = c.executionCtx
      } catch {} // absent outside Workers
      const call = (path: string, init: { method: string; headers: Record<string, string>; body?: unknown }) =>
        app.request(
          new URL(path, c.req.url).toString(),
          {
            method: init.method,
            headers: { ...init.headers, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
          },
          c.env,
          executionCtx,
        )
      const api: Api = {
        endpoint: origin,
        request: async (method, path, body) => readResponse(await call(path, { method, headers: { ...forward, origin }, body })),
        ingest: async (writeKey, body) => readResponse(await call('/v1/batch', { method: 'POST', headers: { authorization: `Bearer ${writeKey}` }, body })),
      }
      const response = await handlePayload(payload, { api, tzOffset: 0, log: (m) => console.warn(m) })
      if (response === null) return c.body(null, 202)
      return c.json(response)
    },
  )
}
