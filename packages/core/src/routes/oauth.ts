import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { OAuthClientsTable } from '../db/schema.js'
import { apiError, publicOrigin, readBody, readJson, type AppEnv } from '../http.js'
import { OAUTH_ACCESS_PREFIX, OAUTH_CLIENT_SECRET_PREFIX, OAUTH_REFRESH_PREFIX, hashToken } from '../tokens.js'
import { DAY, base64url, randomString, safeEqual, sha256 } from '../util.js'
import { requireSession } from './session.js'

// OAuth 2.1 authorization server for the MCP endpoint, following the MCP
// authorization spec: protected resource metadata (RFC 9728), server metadata
// (RFC 8414), dynamic client registration (RFC 7591), authorization code with
// PKCE S256, rotating refresh tokens, revocation (RFC 7009). The only user is
// the admin, who approves each client on the dashboard's /authorize page.

export const ACCESS_TTL_S = 3600
const REFRESH_TTL_MS = 90 * DAY
const CODE_TTL_MS = 5 * 60_000

const ALPHANUMERIC = '0123456789abcdefghijklmnopqrstuvwxyz'

export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/mcp`

// Errors --------------------------------------------------------------------------

class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: 400 | 401 = 400,
  ) {
    super(description)
  }
}

const oauthJson = (c: Context, body: object, status: 200 | 201 | 400 | 401 = 200) =>
  c.json(body, status, { 'cache-control': 'no-store', pragma: 'no-cache' })

async function handleOAuth(c: Context, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof OAuthError) return oauthJson(c, { error: error.error, error_description: error.description }, error.status)
    throw error
  }
}

// Clients and redirect URIs ------------------------------------------------------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:'])

/** https, http on loopback (native apps, RFC 8252), or a private-use scheme such as cursor://. */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.hash) return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname)
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !BLOCKED_SCHEMES.has(url.protocol)
}

/** Exact match, except that loopback redirects may use any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string, given: string): boolean {
  if (registered === given) return true
  try {
    const a = new URL(registered)
    const b = new URL(given)
    if (a.protocol !== 'http:' || b.protocol !== 'http:' || !LOOPBACK.has(a.hostname)) return false
    return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

const redirectUrisOf = (client: OAuthClientsTable): string[] => {
  try {
    const parsed = JSON.parse(client.redirect_uris)
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
  } catch {
    return []
  }
}

/** The MCP endpoint is the only protected resource; accept it with or without the path. */
function normalizeResource(raw: string | undefined, origin: string): string | null | undefined {
  if (!raw) return null
  const value = raw.replace(/\/+$/, '')
  return value === `${origin}/mcp` || value === origin ? `${origin}/mcp` : undefined
}

// Authorization requests ---------------------------------------------------------

const authorizationParams = z.object({
  response_type: z.string().optional(),
  client_id: z.string().max(100).optional(),
  redirect_uri: z.string().max(2000).optional(),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().optional(),
  state: z.string().max(2000).optional(),
  scope: z.string().max(1000).optional(),
  resource: z.string().max(2000).optional(),
})
type AuthorizationParams = z.infer<typeof authorizationParams>

type Validated =
  | { ok: true; client: OAuthClientsTable; redirectUri: string; challenge: string; resource: string | null; state?: string }
  /** `redirectUri` is set when the client can be told about the error by redirect. */
  | { ok: false; error: string; description: string; redirectUri?: string; state?: string }

async function validateAuthorization(c: Context<AppEnv>, raw: Record<string, unknown>): Promise<Validated> {
  const parsed = authorizationParams.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_request', description: 'Malformed authorization request' }
  const p: AuthorizationParams = parsed.data
  const client = p.client_id ? await c.get('services').repo.getOAuthClient(p.client_id) : null
  if (!client) return { ok: false, error: 'invalid_client', description: 'Unknown client. Remove the server in your MCP client and add it again.' }
  const registered = redirectUrisOf(client)
  const redirectUri = p.redirect_uri ?? (registered.length === 1 ? registered[0] : undefined)
  if (!redirectUri || !registered.some((r) => redirectMatches(r, redirectUri))) {
    return { ok: false, error: 'invalid_request', description: 'redirect_uri is not registered for this client' }
  }
  const fail = (error: string, description: string): Validated => ({ ok: false, error, description, redirectUri, state: p.state })
  if (p.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')
  if (!p.code_challenge || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) {
    return fail('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256')
  }
  const resource = normalizeResource(p.resource, publicOrigin(c))
  if (resource === undefined) return fail('invalid_target', 'Unknown resource')
  return { ok: true, client, redirectUri, challenge: p.code_challenge, resource, state: p.state }
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value)
  return url.toString()
}

// Token endpoint helpers -----------------------------------------------------------

async function readParams(c: Context): Promise<Record<string, string>> {
  const text = await readBody(c.req.raw, 20_000)
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      return Object.fromEntries(Object.entries(json).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    } catch {
      throw new OAuthError('invalid_request', 'Body must be JSON or form-encoded')
    }
  }
  return Object.fromEntries(new URLSearchParams(text))
}

async function authenticateClient(c: Context<AppEnv>, params: Record<string, string>): Promise<OAuthClientsTable> {
  let id = params.client_id
  let secret = params.client_secret
  const auth = c.req.header('authorization')
  if (auth?.startsWith('Basic ')) {
    try {
      const [user, pass] = atob(auth.slice(6).trim()).split(':')
      id = decodeURIComponent(user ?? '')
      secret = decodeURIComponent(pass ?? '')
    } catch {
      throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401)
    }
  }
  const client = id ? await c.get('services').repo.getOAuthClient(id) : null
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401)
  if (client.secret_hash && !(secret && safeEqual(await hashToken(secret), client.secret_hash))) {
    throw new OAuthError('invalid_client', 'Client authentication failed', 401)
  }
  return client
}

async function newTokens() {
  const access = `${OAUTH_ACCESS_PREFIX}${randomString(40)}`
  const refresh = `${OAUTH_REFRESH_PREFIX}${randomString(40)}`
  const now = Date.now()
  return {
    response: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh },
    row: {
      access_hash: await hashToken(access),
      access_expires_at: now + ACCESS_TTL_S * 1000,
      refresh_hash: await hashToken(refresh),
      refresh_expires_at: now + REFRESH_TTL_MS,
    },
  }
}

// Routes ---------------------------------------------------------------------------

export const oauthRoutes = new Hono<AppEnv>()

// Metadata and the token endpoints are called by browser-based clients too.
oauthRoutes.use('/.well-known/*', cors({ origin: '*', allowMethods: ['GET'] }))
oauthRoutes.use('/oauth/*', cors({ origin: '*', allowMethods: ['GET', 'POST'], allowHeaders: ['authorization', 'content-type'] }))

const protectedResource = (c: Context) => {
  const origin = publicOrigin(c)
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    resource_name: 'Serverless Analytics',
  })
}
oauthRoutes.get('/.well-known/oauth-protected-resource', protectedResource)
oauthRoutes.get('/.well-known/oauth-protected-resource/mcp', protectedResource)

oauthRoutes.get('/.well-known/oauth-authorization-server', (c) => {
  const origin = publicOrigin(c)
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true,
  })
})

const registration = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  client_uri: z.string().max(2000).optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).max(10).optional(),
  response_types: z.array(z.string()).max(10).optional(),
})

oauthRoutes.post('/oauth/register', (c) =>
  handleOAuth(c, async () => {
    const parsed = registration.safeParse(await readJson(c, 20_000).catch(() => null))
    if (!parsed.success) throw new OAuthError('invalid_client_metadata', 'redirect_uris is required')
    const meta = parsed.data
    const bad = meta.redirect_uris.find((u) => !isAllowedRedirectUri(u))
    if (bad) throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${bad}`)
    const method = meta.token_endpoint_auth_method ?? 'none'
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
      throw new OAuthError('invalid_client_metadata', `Unsupported token_endpoint_auth_method: ${method}`)
    }
    const grantTypes = meta.grant_types ?? ['authorization_code', 'refresh_token']
    if (grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported')
    }
    const responseTypes = meta.response_types ?? ['code']
    if (responseTypes.some((r) => r !== 'code')) throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported')
    const clientUri = meta.client_uri && /^https?:\/\//.test(meta.client_uri) ? meta.client_uri : null

    const id = randomString(24, ALPHANUMERIC)
    const secret = method === 'none' ? null : `${OAUTH_CLIENT_SECRET_PREFIX}${randomString(40)}`
    const now = Date.now()
    await c.get('services').repo.createOAuthClient({
      id,
      secret_hash: secret ? await hashToken(secret) : null,
      name: meta.client_name || 'MCP client',
      redirect_uris: JSON.stringify(meta.redirect_uris),
      client_uri: clientUri,
      created_at: now,
    })
    return oauthJson(
      c,
      {
        client_id: id,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(now / 1000),
        client_name: meta.client_name || 'MCP client',
        ...(clientUri ? { client_uri: clientUri } : {}),
        redirect_uris: meta.redirect_uris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: method,
      },
      201,
    )
  }),
)

// Validates, then hands over to the dashboard, which signs the user in if needed.
oauthRoutes.get('/oauth/authorize', async (c) => {
  const result = await validateAuthorization(c, c.req.query())
  if (!result.ok) {
    if (result.redirectUri) {
      return c.redirect(
        redirectWith(result.redirectUri, { error: result.error, error_description: result.description, state: result.state, iss: publicOrigin(c) }),
      )
    }
    return c.text(`Authorization failed: ${result.description}`, 400)
  }
  return c.redirect(`/authorize?${new URLSearchParams(c.req.query())}`)
})

oauthRoutes.post('/oauth/token', (c) =>
  handleOAuth(c, async () => {
    const params = await readParams(c)
    const client = await authenticateClient(c, params)
    const { repo } = c.get('services')

    if (params.grant_type === 'authorization_code') {
      if (!params.code || !params.code_verifier) throw new OAuthError('invalid_request', 'code and code_verifier are required')
      const code = await repo.takeOAuthCode(await hashToken(params.code))
      if (!code || Number(code.expires_at) < Date.now() || code.client_id !== client.id) {
        throw new OAuthError('invalid_grant', 'Authorization code is invalid or expired')
      }
      if (params.redirect_uri !== undefined && params.redirect_uri !== code.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch')
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier) || base64url(await sha256(params.code_verifier)) !== code.code_challenge) {
        throw new OAuthError('invalid_grant', 'PKCE verification failed')
      }
      const resource = normalizeResource(params.resource, publicOrigin(c))
      if (resource === undefined || (resource && code.resource && resource !== code.resource)) throw new OAuthError('invalid_target', 'Unknown resource')
      const tokens = await newTokens()
      await repo.createOAuthGrant({ id: randomString(16, ALPHANUMERIC), client_id: client.id, ...tokens.row, created_at: Date.now(), last_used_at: null })
      return oauthJson(c, tokens.response)
    }

    if (params.grant_type === 'refresh_token') {
      if (!params.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required')
      const hash = await hashToken(params.refresh_token)
      const grant = await repo.findOAuthGrant({ refreshHash: hash })
      if (!grant || grant.client_id !== client.id || Number(grant.refresh_expires_at) < Date.now()) {
        throw new OAuthError('invalid_grant', 'Refresh token is invalid, expired or revoked')
      }
      const tokens = await newTokens()
      if (!(await repo.rotateOAuthGrant(grant.id, hash, tokens.row))) throw new OAuthError('invalid_grant', 'Refresh token was already used')
      return oauthJson(c, tokens.response)
    }

    throw new OAuthError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token')
  }),
)

oauthRoutes.post('/oauth/revoke', (c) =>
  handleOAuth(c, async () => {
    const params = await readParams(c)
    // Anyone holding a token may revoke it; unknown tokens are not an error (RFC 7009).
    if (params.token) await c.get('services').repo.deleteOAuthGrant({ tokenHash: await hashToken(params.token) })
    return c.body(null, 200)
  }),
)

// Dashboard API for the consent page and Settings ---------------------------------

oauthRoutes.get('/api/oauth/authorize', requireSession, async (c) => {
  const result = await validateAuthorization(c, c.req.query())
  if (!result.ok) throw apiError(400, result.error, result.description)
  return c.json({
    client: { id: result.client.id, name: result.client.name, uri: result.client.client_uri },
    redirectUri: result.redirectUri,
  })
})

oauthRoutes.post('/api/oauth/authorize', requireSession, async (c) => {
  const body = z
    .object({ params: z.record(z.string(), z.string()), approve: z.boolean() })
    .safeParse(await readJson(c))
  if (!body.success) throw apiError(400, 'invalid_body', 'params and approve are required')
  const result = await validateAuthorization(c, body.data.params)
  if (!result.ok) throw apiError(400, result.error, result.description)
  const iss = publicOrigin(c)
  if (!body.data.approve) {
    return c.json({ redirectTo: redirectWith(result.redirectUri, { error: 'access_denied', error_description: 'The user denied access', state: result.state, iss }) })
  }
  const code = randomString(40)
  await c.get('services').repo.createOAuthCode({
    code_hash: await hashToken(code),
    client_id: result.client.id,
    redirect_uri: result.redirectUri,
    code_challenge: result.challenge,
    resource: result.resource,
    expires_at: Date.now() + CODE_TTL_MS,
  })
  return c.json({ redirectTo: redirectWith(result.redirectUri, { code, state: result.state, iss }) })
})

oauthRoutes.get('/api/oauth/grants', requireSession, async (c) => c.json({ grants: await c.get('services').repo.listOAuthGrants() }))

oauthRoutes.delete('/api/oauth/grants/:id', requireSession, async (c) => {
  if (!(await c.get('services').repo.deleteOAuthGrant({ id: c.req.param('id') }))) throw apiError(404, 'not_found', 'Authorization not found')
  return c.json({ revoked: true })
})
