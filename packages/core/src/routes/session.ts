import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, checkPassword, verifySessionToken } from '../auth.js'
import { apiError, publicOrigin, type AppEnv } from '../http.js'
import { OAUTH_ACCESS_PREFIX, TOKEN_PREFIX, hashToken } from '../tokens.js'

const TOUCH_EVERY_MS = 3_600_000

/**
 * Dashboard session cookie, or `Authorization: Bearer` with a personal access
 * token (`sa_pat_…`, issued by `sa login`), an OAuth access token (`sa_oat_…`,
 * issued to MCP clients) or ADMIN_API_TOKEN. Bearer requests
 * carry no cookie, so they need no CSRF check.
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config, repo } = c.get('services')
  const auth = c.req.header('authorization')
  if (auth?.startsWith('Bearer ')) {
    const secret = auth.slice(7).trim()
    if (secret.startsWith(TOKEN_PREFIX)) {
      const token = await repo.findActiveToken(await hashToken(secret))
      if (!token) throw apiError(401, 'unauthorized', 'Invalid or revoked access token')
      const now = Date.now()
      if (!token.lastUsedAt || now - token.lastUsedAt > TOUCH_EVERY_MS) {
        c.get('services').waitUntil(repo.touchToken(token.id, now).catch(() => {}))
      }
      c.set('token', token)
      return next()
    }
    if (secret.startsWith(OAUTH_ACCESS_PREFIX)) {
      const grant = await repo.findOAuthGrant({ accessHash: await hashToken(secret) })
      const now = Date.now()
      if (!grant || Number(grant.access_expires_at) < now) throw apiError(401, 'invalid_token', 'Invalid or expired access token')
      const lastUsedAt = grant.last_used_at == null ? null : Number(grant.last_used_at)
      if (!lastUsedAt || now - lastUsedAt > TOUCH_EVERY_MS) {
        c.get('services').waitUntil(repo.touchOAuthGrant(grant.id, now).catch(() => {}))
      }
      c.set('token', { id: grant.id, name: grant.client_name, prefix: OAUTH_ACCESS_PREFIX, createdAt: Number(grant.created_at), lastUsedAt })
      return next()
    }
    if (config.auth.apiToken && (await checkPassword(config.auth.apiToken, secret))) return next()
    throw apiError(401, 'unauthorized', 'Invalid API token')
  }
  if (!(await verifySessionToken(config.auth.sessionSecret, getCookie(c, SESSION_COOKIE)))) {
    throw apiError(401, 'unauthorized', 'Sign in to continue')
  }
  // CSRF: SameSite=Lax already blocks cross-site cookies on POST; also reject
  // mutating requests whose Origin doesn't match.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin')
    if (origin && origin !== publicOrigin(c)) throw apiError(403, 'bad_origin', 'Cross-origin request rejected')
  }
  await next()
}
