import type {
  ActiveUsers,
  ErrorDetailResponse,
  ErrorsResponse,
  FunnelResponse,
  ApiError as ApiErrorBody,
  App,
  AppWithStats,
  DefinitionsResponse,
  EventDefinition,
  EventsResponse,
  InsightsResponse,
  OverviewResponse,
  PropertyDefinition,
  SchemaMode,
  SessionResponse,
  SystemResponse,
  TopResponse,
} from '@serverless-analytics/core/types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null
    if (res.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event('sa:unauthorized'))
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export const tzOffset = () => -new Date().getTimezoneOffset()

export type Query = Record<string, string | string[] | number | undefined | null>

export function qs(params: Query): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

const app = (id: string) => `/api/apps/${encodeURIComponent(id)}`

export const api = {
  session: () => request<SessionResponse>('/api/auth/session'),
  login: (password: string) => request<{ authenticated: boolean }>('/api/auth/login', { method: 'POST', json: { password } }),
  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),

  system: () => request<SystemResponse>('/api/system'),
  migrate: () => request<{ ran: string[] }>('/api/system/migrate', { method: 'POST' }),

  apps: () => request<{ apps: AppWithStats[] }>(`/api/apps${qs({ tz: tzOffset() })}`),
  app: (id: string) => request<{ app: App }>(app(id)),
  createApp: (body: { name: string; schemaMode: SchemaMode }) => request<{ app: App }>('/api/apps', { method: 'POST', json: body }),
  updateApp: (id: string, body: Partial<Pick<App, 'name' | 'schemaMode' | 'retentionDays' | 'sampling'>>) =>
    request<{ app: App }>(app(id), { method: 'PATCH', json: body }),
  rotateKey: (id: string) => request<{ app: App }>(`${app(id)}/rotate-key`, { method: 'POST' }),
  deleteApp: (id: string) => request<{ deleted: boolean }>(app(id), { method: 'DELETE' }),

  overview: (id: string, q: Query) => request<OverviewResponse>(`${app(id)}/overview${qs({ ...q, tz: tzOffset() })}`),
  top: (id: string, q: Query) => request<TopResponse>(`${app(id)}/top${qs({ ...q, tz: tzOffset() })}`),
  insights: (id: string, q: Query) => request<InsightsResponse>(`${app(id)}/insights${qs({ ...q, tz: tzOffset() })}`),
  events: (id: string, q: Query) => request<EventsResponse>(`${app(id)}/events${qs(q)}`),
  properties: (id: string, event: string | null) => request<{ keys: string[] }>(`${app(id)}/properties${qs({ event })}`),

  activeUsers: (id: string, q: Query) => request<ActiveUsers>(`${app(id)}/active-users${qs(q)}`),
  funnel: (id: string, q: Query) => request<FunnelResponse>(`${app(id)}/funnel${qs({ ...q, tz: tzOffset() })}`),
  errors: (id: string, q: Query) => request<ErrorsResponse>(`${app(id)}/errors${qs({ ...q, tz: tzOffset() })}`),
  errorDetail: (id: string, fingerprint: string, q: Query) =>
    request<ErrorDetailResponse>(`${app(id)}/errors/${encodeURIComponent(fingerprint)}${qs({ ...q, tz: tzOffset() })}`),

  definitions: (id: string) => request<DefinitionsResponse>(`${app(id)}/definitions`),
  createDefinition: (id: string, body: DefinitionInput & { name: string }) =>
    request<{ definition: EventDefinition }>(`${app(id)}/definitions`, { method: 'POST', json: body }),
  updateDefinition: (id: string, name: string, body: DefinitionInput) =>
    request<{ definition: EventDefinition }>(`${app(id)}/definitions/${encodeURIComponent(name)}`, { method: 'PATCH', json: body }),
  deleteDefinition: (id: string, name: string) =>
    request<{ deleted: boolean }>(`${app(id)}/definitions/${encodeURIComponent(name)}`, { method: 'DELETE' }),
}

export interface DefinitionInput {
  description: string
  status: EventDefinition['status']
  properties: PropertyDefinition[]
}
