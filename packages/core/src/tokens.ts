import { randomString, sha256 } from './util.js'

// Personal access tokens: `sa_pat_<40 chars>`. Only the SHA-256 is stored.

export const TOKEN_PREFIX = 'sa_pat_'

// OAuth tokens for MCP clients (routes/oauth.ts).
export const OAUTH_ACCESS_PREFIX = 'sa_oat_'
export const OAUTH_REFRESH_PREFIX = 'sa_ort_'
export const OAUTH_CLIENT_SECRET_PREFIX = 'sa_ocs_'

export const newAccessToken = () => `${TOKEN_PREFIX}${randomString(40)}`

export async function hashToken(token: string): Promise<string> {
  return [...(await sha256(token))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Human-typable code for the device flow, e.g. "K7QD-M3XW" (no 0/O/1/I). */
export const newUserCode = () => {
  const code = randomString(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
