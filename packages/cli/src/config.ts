import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface StoredConfig {
  endpoint?: string
  token?: string
  tokenName?: string
  /** A started-but-unfinished `sa login --no-wait`. */
  pending?: { endpoint: string; deviceCode: string; userCode: string; verificationUri: string; expiresAt: number; interval: number }
}

export function configDir(env = process.env): string {
  if (env.SA_CONFIG_DIR) return env.SA_CONFIG_DIR
  const base = env.XDG_CONFIG_HOME || (process.platform === 'win32' ? env.APPDATA : undefined) || join(homedir(), '.config')
  return join(base, 'serverless-analytics')
}

export const configPath = (env = process.env) => join(configDir(env), 'config.json')

export async function loadConfig(env = process.env): Promise<StoredConfig> {
  try {
    return JSON.parse(await readFile(configPath(env), 'utf8')) as StoredConfig
  } catch {
    return {}
  }
}

export async function saveConfig(config: StoredConfig, env = process.env): Promise<void> {
  await mkdir(configDir(env), { recursive: true, mode: 0o700 })
  const path = configPath(env)
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await chmod(path, 0o600).catch(() => {})
}

/** Environment variables win over the config file (useful for CI and agents). */
export function resolveAuth(config: StoredConfig, overrides: { endpoint?: string; token?: string }, env = process.env) {
  const endpoint = (overrides.endpoint ?? env.SA_ENDPOINT ?? config.endpoint)?.replace(/\/+$/, '')
  const token = overrides.token ?? env.SA_TOKEN ?? config.token
  return { endpoint, token }
}
