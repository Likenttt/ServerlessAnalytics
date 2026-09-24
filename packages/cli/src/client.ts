export const VERSION = '0.1.0'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type QueryValue = string | number | undefined | null | (string | number)[]

export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export class Client {
  constructor(
    readonly endpoint: string,
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { 'user-agent': `serverless-analytics-cli/${VERSION}`, ...opts.headers }
    if (opts.auth !== false && this.token) headers.authorization = `Bearer ${this.token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    let res: Response
    try {
      res = await this.fetchImpl(`${this.endpoint}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (error) {
      throw new ApiError(0, 'network_error', `Could not reach ${this.endpoint}: ${(error as Error).message}`)
    }
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

  get = <T>(path: string) => this.request<T>('GET', path)
  post = <T>(path: string, body?: unknown) => this.request<T>('POST', path, body ?? {})
  patch = <T>(path: string, body: unknown) => this.request<T>('PATCH', path, body)
  delete = <T>(path: string) => this.request<T>('DELETE', path)
}
