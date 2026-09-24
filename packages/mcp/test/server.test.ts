import { describe, expect, it } from 'vitest'
import { ApiError, handleMessage, handlePayload, TOOLS, type Api } from '../src/index.js'

const APPS = [
  { id: 'a1', name: 'Acme iOS', writeKey: 'wk_1', schemaMode: 'permissive', retentionDays: 365, sampling: { mode: 'full', strategy: 'user', rate: 1, overrides: [] }, createdAt: 0, updatedAt: 0, events24h: 5, sparkline: [1, 2, 3, 0, 0, 0, 4] },
]

function fakeApi() {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const api: Api = {
    endpoint: 'https://analytics.test',
    async request<T>(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body })
      if (path === '/api/apps' && method === 'GET') return { apps: APPS } as T
      if (path.startsWith('/api/apps/a1/overview')) return { totals: { events: 3, users: 2 } } as T
      if (path === '/api/apps/a1' && method === 'PATCH') return { app: { ...APPS[0], sampling: (body as { sampling: unknown }).sampling } } as T
      if (path.startsWith('/api/apps/missing')) throw new ApiError(404, 'app_not_found', 'nope')
      return {} as T
    },
    async ingest<T>(writeKey: string, body: unknown) {
      calls.push({ method: 'INGEST', path: writeKey, body })
      return { ok: true, accepted: 1, sampled: 0, rejected: [] } as T
    },
  }
  return { api, calls }
}

const call = (api: Api, name: string, args: Record<string, unknown> = {}) =>
  handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, { api, tzOffset: 480 }) as Promise<{
    result: { content: { text: string }[]; isError?: boolean }
  }>
const body = (r: { result: { content: { text: string }[] } }) => JSON.parse(r.result.content[0]!.text)

describe('MCP protocol', () => {
  it('negotiates the protocol version and advertises tools', async () => {
    const { api } = fakeApi()
    const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, { api })
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'serverless-analytics' } } })
    const unknown = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, { api })
    expect((unknown!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18')

    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, { api })).toBeNull()
    expect(await handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, { api })).toEqual({ jsonrpc: '2.0', id: 3, result: {} })
    expect(await handleMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, { api })).toMatchObject({ error: { code: -32601 } })
    expect(await handleMessage({ nope: true }, { api })).toMatchObject({ error: { code: -32600 } })

    const list = (await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { api }))!.result as { tools: { name: string; inputSchema: { type: string } }[] }
    expect(list.tools.length).toBe(TOOLS.length)
    expect(list.tools.every((t) => t.inputSchema.type === 'object')).toBe(true)
    expect(list.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['create_app', 'define_event', 'query_trend', 'query_funnel', 'set_sampling']))
  })

  it('resolves apps by name and passes query options through', async () => {
    const { api, calls } = fakeApi()
    const res = await call(api, 'query_overview', { app: 'acme ios', range: '30d', filters: { platform: 'ios', 'prop:plan': 'pro' } })
    expect(body(res)).toEqual({ totals: { events: 3, users: 2 } })
    const path = calls.at(-1)!.path
    expect(path).toContain('/api/apps/a1/overview?')
    expect(new URLSearchParams(path.split('?')[1]).getAll('f')).toEqual(['platform=ios', 'prop:plan=pro'])
    expect(path).toContain('range=30d')
    expect(path).toContain('tz=480')
  })

  it('returns tool errors as isError results, and guards destructive tools', async () => {
    const { api, calls } = fakeApi()
    const missing = await call(api, 'get_app', { app: 'nope' })
    expect(missing.result.isError).toBe(true)
    expect(body(missing).error.code).toBe('app_not_found')

    const guarded = await call(api, 'delete_app', { app: 'a1' })
    expect(body(guarded).error.code).toBe('confirmation_required')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await call(api, 'delete_app', { app: 'a1', confirm: true })
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/apps/a1' })

    expect(await handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } }, { api })).toMatchObject({ error: { code: -32602 } })
  })

  it('keeps current sampling settings when only some fields change', async () => {
    const { api, calls } = fakeApi()
    const res = await call(api, 'set_sampling', { app: 'a1', rate: 0.1, overrides: [{ event: 'purchase', rate: 1 }] })
    expect(body(res).sampling).toEqual({ mode: 'sampled', strategy: 'user', rate: 0.1, overrides: [{ event: 'purchase', rate: 1 }] })
    expect(calls.at(-1)!.method).toBe('PATCH')
  })

  it('sends test events with the app write key and builds snippets', async () => {
    const { api, calls } = fakeApi()
    const sent = body(await call(api, 'send_test_event', { app: 'a1', event: 'signup', properties: { method: 'email' } }))
    expect(sent).toMatchObject({ accepted: 1, event: { name: 'signup', properties: { method: 'email' } } })
    expect(calls.at(-1)).toMatchObject({ method: 'INGEST', path: 'wk_1' })
    const snippet = body(await call(api, 'get_integration_snippet', { app: 'a1', lang: 'swift' }))
    expect(snippet.code).toContain('https://analytics.test/v1/batch')
    expect(snippet.code).toContain('Bearer wk_1')
  })

  it('handles batches and drops notification replies', async () => {
    const { api } = fakeApi()
    const res = await handlePayload(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
      { api },
    )
    expect(res).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }])
  })
})
