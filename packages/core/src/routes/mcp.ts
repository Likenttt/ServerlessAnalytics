import { handlePayload, parseError, readResponse, type Api } from '@serverless-analytics/mcp'
import type { Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import { publicOrigin, readBody, type AppEnv } from '../http.js'
import { resourceMetadataUrl } from './oauth.js'
import { requireSession } from './session.js'

/**
 * Remote MCP server (Streamable HTTP, stateless JSON responses) at /mcp.
 * Authenticate with `Authorization: Bearer <token>`: an OAuth access token
 * (discovered through the 401 challenge) or a personal access token. Tools call the
 * dashboard API in-process with the same credentials, so every check applies.
 */
const challenge = (c: Context, error?: string) =>
  `Bearer realm="serverless-analytics", ${error ? `error="${error}", ` : ''}resource_metadata="${resourceMetadataUrl(publicOrigin(c))}"`

export function mountMcp(app: Hono<AppEnv>) {
  // Browser-based clients (e.g. MCP Inspector). Bearer auth only; cookies aren't sent cross-origin.
  app.use(
    '/mcp',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'],
      exposeHeaders: ['www-authenticate', 'mcp-session-id'],
    }),
  )
  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json({ error: { code: 'method_not_allowed', message: 'This MCP server is stateless: POST JSON-RPC messages to /mcp.' } }, 405, { allow: 'POST' }),
  )

  app.post(
    '/mcp',
    async (c, next) => {
      // Point MCP clients at the OAuth metadata (RFC 9728) on every 401.
      if (!c.req.header('authorization') && !c.req.header('cookie')) {
        return c.json(
          { error: { code: 'unauthorized', message: 'Sign in with OAuth, or send Authorization: Bearer <access token> (Settings → Access tokens).' } },
          401,
          { 'www-authenticate': challenge(c) },
        )
      }
      await next()
      if (c.res.status === 401) {
        c.res = new Response(c.res.body, c.res)
        c.res.headers.set('www-authenticate', challenge(c, 'invalid_token'))
      }
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
