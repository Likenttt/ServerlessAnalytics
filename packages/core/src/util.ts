import type { Interval, TimeRange } from './types.js'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function randomString(length: number, alphabet = ALPHABET): string {
  // Rejection sampling keeps the distribution uniform.
  const max = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const b of bytes) {
      if (b < max) out += alphabet[b % alphabet.length]
      if (out.length === length) break
    }
  }
  return out
}

export const newAppId = () => randomString(10, '0123456789abcdefghijklmnopqrstuvwxyz')
export const newWriteKey = () => `wk_${randomString(32)}`

export const HOUR = 3_600_000
export const DAY = 86_400_000
export const INTERVAL_MS: Record<Interval, number> = { hour: HOUR, day: DAY }

/** Bucket index for a timestamp; matches SqlDialect.bucket(). */
export const bucketOf = (ts: number, intervalMs: number, offsetMs: number) => Math.floor((ts + offsetMs) / intervalMs)

/** Start timestamps of each bucket in the range. */
export function rangeBuckets(range: TimeRange): number[] {
  const iv = INTERVAL_MS[range.interval]
  const off = range.tzOffset * 60_000
  const first = bucketOf(range.from, iv, off)
  const last = bucketOf(range.to - 1, iv, off)
  const buckets: number[] = []
  for (let b = first; b <= last; b++) buckets.push(b * iv - off)
  return buckets
}

/** A range of `count` whole buckets ending with the bucket containing `now`. */
export function trailingRange(now: number, count: number, interval: Interval, tzOffset: number): TimeRange {
  const iv = INTERVAL_MS[interval]
  const off = tzOffset * 60_000
  const lastStart = bucketOf(now, iv, off) * iv - off
  return { from: lastStart - (count - 1) * iv, to: lastStart + iv, interval, tzOffset }
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

export async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))
}

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}
