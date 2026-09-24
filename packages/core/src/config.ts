// Runtime configuration, resolved from environment variables and platform
// bindings. This is the contract documented in docs/CONFIGURATION.md: every
// deployment (and the setup skill that generates one) only has to set these
// variables — no code changes are needed to switch drivers.

export const DB_DRIVERS = ['d1', 'postgres'] as const
export const KV_DRIVERS = ['cloudflare', 'upstash', 'memory'] as const
export const QUEUE_DRIVERS = ['direct', 'background', 'cloudflare', 'qstash'] as const

export type DbDriver = (typeof DB_DRIVERS)[number]
export type KvDriver = (typeof KV_DRIVERS)[number]
export type QueueDriver = (typeof QUEUE_DRIVERS)[number]

export interface Config {
  database: { driver: 'd1' } | { driver: 'postgres'; url: string }
  kv: { driver: 'cloudflare' } | { driver: 'upstash'; url: string; token: string } | { driver: 'memory' }
  queue:
    | { driver: 'direct' }
    | { driver: 'background' }
    | { driver: 'cloudflare' }
    | {
        driver: 'qstash'
        token: string
        baseUrl: string
        currentSigningKey: string
        nextSigningKey: string
        /** Public base URL QStash delivers to. Falls back to the request origin. */
        publicUrl: string | null
      }
  auth: { adminPassword: string; sessionSecret: string }
  ingest: { maxBatchSize: number; maxBodyBytes: number }
  cronSecret: string | null
}

/** Names of the platform bindings we look for on Cloudflare. */
export const BINDINGS = {
  d1: 'DB',
  kv: 'KV',
  queue: 'EVENTS_QUEUE',
  hyperdrive: 'HYPERDRIVE',
} as const

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, unknown>

const str = (env: Env, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

const has = (env: Env, key: string) => env[key] != null && typeof env[key] === 'object'

function oneOf<T extends string>(
  problems: string[],
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback
  if ((allowed as readonly string[]).includes(value)) return value as T
  problems.push(`${name} must be one of ${allowed.join(', ')} (got "${value}")`)
  return fallback
}

function int(problems: string[], name: string, value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max} (got "${value}")`)
    return fallback
  }
  return n
}

export function resolveConfig(env: Env): Config {
  const problems: string[] = []

  // Database -----------------------------------------------------------------
  const hyperdrive = env[BINDINGS.hyperdrive] as { connectionString?: string } | undefined
  const pgUrl = hyperdrive?.connectionString ?? str(env, 'DATABASE_URL', 'POSTGRES_URL')
  const dbDriver = oneOf(problems, 'DB_DRIVER', str(env, 'DB_DRIVER'), DB_DRIVERS, has(env, BINDINGS.d1) || !pgUrl ? 'd1' : 'postgres')
  let database: Config['database'] = { driver: 'd1' }
  if (dbDriver === 'd1') {
    if (!has(env, BINDINGS.d1)) problems.push(`DB_DRIVER=d1 requires a D1 binding named "${BINDINGS.d1}"`)
  } else if (!pgUrl) {
    problems.push(`DB_DRIVER=postgres requires DATABASE_URL (or a Hyperdrive binding named "${BINDINGS.hyperdrive}")`)
  } else {
    database = { driver: 'postgres', url: pgUrl }
  }

  // KV -----------------------------------------------------------------------
  const upstashUrl = str(env, 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL')
  const upstashToken = str(env, 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN')
  const kvDefault: KvDriver = has(env, BINDINGS.kv) ? 'cloudflare' : upstashUrl ? 'upstash' : 'memory'
  const kvDriver = oneOf(problems, 'KV_DRIVER', str(env, 'KV_DRIVER'), KV_DRIVERS, kvDefault)
  let kv: Config['kv'] = { driver: 'memory' }
  if (kvDriver === 'cloudflare') {
    if (has(env, BINDINGS.kv)) kv = { driver: 'cloudflare' }
    else problems.push(`KV_DRIVER=cloudflare requires a KV namespace binding named "${BINDINGS.kv}"`)
  } else if (kvDriver === 'upstash') {
    if (upstashUrl && upstashToken) kv = { driver: 'upstash', url: upstashUrl, token: upstashToken }
    else problems.push('KV_DRIVER=upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')
  }

  // Queue --------------------------------------------------------------------
  const queueDriver = oneOf(problems, 'QUEUE_DRIVER', str(env, 'QUEUE_DRIVER'), QUEUE_DRIVERS, 'direct')
  let queue: Config['queue'] = { driver: 'direct' }
  if (queueDriver === 'background') {
    queue = { driver: 'background' }
  } else if (queueDriver === 'cloudflare') {
    if (has(env, BINDINGS.queue)) queue = { driver: 'cloudflare' }
    else problems.push(`QUEUE_DRIVER=cloudflare requires a Queue producer binding named "${BINDINGS.queue}"`)
  } else if (queueDriver === 'qstash') {
    const token = str(env, 'QSTASH_TOKEN')
    const current = str(env, 'QSTASH_CURRENT_SIGNING_KEY')
    const next = str(env, 'QSTASH_NEXT_SIGNING_KEY')
    if (!token || !current || !next) {
      problems.push('QUEUE_DRIVER=qstash requires QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY')
    } else {
      queue = {
        driver: 'qstash',
        token,
        baseUrl: (str(env, 'QSTASH_URL') ?? 'https://qstash.upstash.io').replace(/\/+$/, ''),
        currentSigningKey: current,
        nextSigningKey: next,
        publicUrl: str(env, 'PUBLIC_URL')?.replace(/\/+$/, '') ?? null,
      }
    }
  }

  // Auth ---------------------------------------------------------------------
  const adminPassword = str(env, 'ADMIN_PASSWORD')
  if (!adminPassword) problems.push('ADMIN_PASSWORD is required')
  else if (adminPassword.length < 8) problems.push('ADMIN_PASSWORD must be at least 8 characters')

  const ingest = {
    maxBatchSize: int(problems, 'MAX_BATCH_SIZE', str(env, 'MAX_BATCH_SIZE'), 100, 1, 1000),
    maxBodyBytes: int(problems, 'MAX_BODY_BYTES', str(env, 'MAX_BODY_BYTES'), 1_000_000, 1024, 10_000_000),
  }

  if (problems.length > 0) throw new ConfigError(problems)

  return {
    database,
    kv,
    queue,
    auth: { adminPassword: adminPassword!, sessionSecret: str(env, 'SESSION_SECRET') ?? adminPassword! },
    ingest,
    cronSecret: str(env, 'CRON_SECRET') ?? null,
  }
}
