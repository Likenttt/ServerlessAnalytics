import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { apiError, publicOrigin, readJson, type AppEnv } from '../http.js'
import { issueToken } from '../services.js'
import { hashToken, newUserCode } from '../tokens.js'
import { randomString } from '../util.js'
import { requireSession } from './session.js'

// Browser login for `sa login` (OAuth-style device flow):
//   1. CLI  POST /api/cli/auth/start  → deviceCode (secret) + userCode (shown)
//   2. User opens /cli/authorize?code=USER-CODE in a signed-in dashboard
//      and approves, which issues a personal access token
//   3. CLI  POST /api/cli/auth/poll with the deviceCode → token, exactly once

export const cliRoutes = new Hono<AppEnv>()

const EXPIRES_IN_S = 600
const POLL_INTERVAL_S = 2

type Status = 'pending' | 'approved' | 'denied'

cliRoutes.post('/cli/auth/start', async (c) => {
  const body = z.object({ name: z.string().trim().min(1).max(64).optional() }).safeParse(await readJson(c).catch(() => ({})))
  const name = (body.success && body.data.name) || 'CLI'
  const deviceCode = randomString(40)
  const userCode = newUserCode()
  const now = Date.now()
  await c.get('services').repo.createCliAuthRequest({
    device_code_hash: await hashToken(deviceCode),
    user_code: userCode,
    name,
    status: 'pending' satisfies Status,
    token: null,
    created_at: now,
    expires_at: now + EXPIRES_IN_S * 1000,
  })
  const verificationUri = `${publicOrigin(c)}/cli/authorize`
  return c.json({
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${userCode}`,
    expiresIn: EXPIRES_IN_S,
    interval: POLL_INTERVAL_S,
  })
})

cliRoutes.post('/cli/auth/poll', async (c) => {
  const body = z.object({ deviceCode: z.string().min(1).max(128) }).safeParse(await readJson(c))
  if (!body.success) throw apiError(400, 'invalid_body', 'deviceCode is required')
  const { repo } = c.get('services')
  const hash = await hashToken(body.data.deviceCode)
  const request = await repo.getCliAuthRequest({ deviceCodeHash: hash })
  if (!request || request.expires_at < Date.now()) return c.json({ status: 'expired' })
  if (request.status === 'denied') {
    await repo.deleteCliAuthRequest(hash)
    return c.json({ status: 'denied' })
  }
  if (request.status === 'approved' && request.token) {
    // Hand the secret over once, then forget it.
    await repo.deleteCliAuthRequest(hash)
    return c.json({ status: 'approved', token: request.token, name: request.name })
  }
  return c.json({ status: 'pending' })
})

const userCodeBody = z.object({ userCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid code') })

async function pendingRequest(c: Context<AppEnv>, userCode: string) {
  const request = await c.get('services').repo.getCliAuthRequest({ userCode })
  if (!request || request.expires_at < Date.now()) throw apiError(404, 'code_not_found', 'This code is invalid or has expired. Run `sa login` again.')
  if (request.status !== 'pending') throw apiError(409, 'code_used', 'This code was already used')
  return request
}

cliRoutes.get('/cli/auth/request', requireSession, async (c) => {
  const parsed = userCodeBody.safeParse({ userCode: c.req.query('code') ?? '' })
  if (!parsed.success) throw apiError(400, 'invalid_code', 'Invalid code')
  const request = await pendingRequest(c, parsed.data.userCode)
  return c.json({ userCode: request.user_code, name: request.name, createdAt: Number(request.created_at), expiresAt: Number(request.expires_at) })
})

cliRoutes.post('/cli/auth/approve', requireSession, async (c) => {
  const parsed = userCodeBody.safeParse(await readJson(c))
  if (!parsed.success) throw apiError(400, 'invalid_code', 'Invalid code')
  const request = await pendingRequest(c, parsed.data.userCode)
  const { repo } = c.get('services')
  const { token, record } = await issueToken(repo, request.name)
  await repo.updateCliAuthRequest(request.device_code_hash, { status: 'approved' satisfies Status, token })
  return c.json({ approved: true, token: record })
})

cliRoutes.post('/cli/auth/deny', requireSession, async (c) => {
  const parsed = userCodeBody.safeParse(await readJson(c))
  if (!parsed.success) throw apiError(400, 'invalid_code', 'Invalid code')
  const request = await pendingRequest(c, parsed.data.userCode)
  await c.get('services').repo.updateCliAuthRequest(request.device_code_hash, { status: 'denied' satisfies Status })
  return c.json({ denied: true })
})
