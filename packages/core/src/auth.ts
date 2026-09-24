import { base64url, hmacSha256, safeEqual } from './util.js'

// Single-user auth: one admin password, exchanged for a stateless signed
// session cookie. Changing ADMIN_PASSWORD (or SESSION_SECRET) signs everyone out.

export const SESSION_COOKIE = 'sa_session'
export const SESSION_TTL_SECONDS = 30 * 86_400

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS
  return `${expires}.${base64url(await hmacSha256(secret, `session:${expires}`))}`
}

export async function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false
  const [expires, signature] = token.split('.')
  if (!expires || !signature || !/^\d+$/.test(expires)) return false
  if (Number(expires) < Math.floor(now / 1000)) return false
  return safeEqual(base64url(await hmacSha256(secret, `session:${expires}`)), signature)
}

export async function checkPassword(expected: string, given: string): Promise<boolean> {
  // Compare fixed-length digests so timing doesn't leak the password length.
  const key = 'password-check'
  return safeEqual(base64url(await hmacSha256(key, expected)), base64url(await hmacSha256(key, given)))
}
