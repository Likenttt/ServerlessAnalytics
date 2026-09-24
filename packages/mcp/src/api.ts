import type { App, AppWithStats } from '@serverless-analytics/core/types'

/** How tools reach the dashboard API: over HTTP (CLI) or in-process (remote /mcp). */
export interface Api {
  endpoint: string
  request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>
  /** POST to the public ingestion API with an app's write key. */
  ingest<T>(writeKey: string, body: unknown): Promise<T>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Throws ApiError for non-2xx JSON error bodies. Shared by both transports. */
export async function readResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`)
  }
  return data as T
}

export type Query = Record<string, string | number | undefined | null | (string | number)[]>

export function qs(params: Query): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

/** Accepts an app id or its (case-insensitive) name. */
export async function resolveApp(api: Api, ref: string): Promise<App> {
  const { apps } = await api.request<{ apps: AppWithStats[] }>('GET', '/api/apps')
  const byId = apps.find((a) => a.id === ref)
  if (byId) return byId
  const matches = apps.filter((a) => a.name.toLowerCase() === ref.trim().toLowerCase())
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new ApiError(400, 'ambiguous_app', `Several apps are named "${ref}"; use the id (${matches.map((a) => a.id).join(', ')})`)
  throw new ApiError(404, 'app_not_found', `No app "${ref}". Call list_apps to see available apps.`)
}

export const appPath = (app: Pick<App, 'id'>) => `/api/apps/${encodeURIComponent(app.id)}`
