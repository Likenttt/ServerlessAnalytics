import { ApiError, type Api } from './api.js'
import { TOOLS } from './tools.js'

// Minimal MCP server (JSON-RPC 2.0): initialize, ping, tools/list, tools/call.
// Stateless, so it works per request on serverless and over stdio alike.

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
export const SERVER_INFO = { name: 'serverless-analytics', title: 'Serverless Analytics', version: '0.1.0' }

export const INSTRUCTIONS = `Tools for a self-hosted product analytics deployment.
- Apps are tracked projects; refer to them by id or name (list_apps).
- To onboard a project: list_apps → create_app → get_integration_snippet for the project's platform → integrate → define_event for the key events → send_test_event / query_events to verify.
- Metrics: events, users (unique), per_user, sum:<prop>, avg:<prop>. Break down or filter by name, platform, channel, country, region, os, os_version, browser, app_version, device, locale or prop:<key>.
- Answer questions with query_overview, query_active_users, query_trend, query_top, query_funnel and query_errors; state the time range and filters you used. The last bucket of a trend is still in progress. When an app is sampled, numbers are estimates.
- Ask the user before destructive actions (delete_app, rotate_write_key, delete_event_definition); they require confirm: true.`

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const ok = (id: JsonRpcResponse['id'], result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
const fail = (id: JsonRpcResponse['id'], code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602

export interface ServerOptions {
  api: Api
  /** Default timezone offset (minutes east of UTC) for bucketed queries. */
  tzOffset?: number
  log?: (message: string) => void
}

/** Handles one message. Returns null for notifications (no reply). */
export async function handleMessage(message: unknown, options: ServerOptions): Promise<JsonRpcResponse | null> {
  const msg = message as Partial<JsonRpcRequest>
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return fail((msg as { id?: JsonRpcResponse['id'] })?.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC request')
  }
  const isNotification = msg.id === undefined
  const id = msg.id ?? null

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return isNotification ? null : ok(id, {})
    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })),
      })
    case 'tools/call': {
      const name = msg.params?.name
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`)
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const result = await tool.run(options.api, args, { tzOffset: options.tzOffset ?? 0 })
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (error) {
        // Tool failures are results the model can read and act on, not protocol errors.
        const e = error as Partial<ApiError> & Error
        options.log?.(`[mcp] ${tool.name} failed: ${e.message}`)
        const detail = error instanceof ApiError ? { code: e.code, status: e.status, message: e.message } : { message: e.message }
        return ok(id, { content: [{ type: 'text', text: JSON.stringify({ error: detail }) }], isError: true })
      }
    }
    default:
      if (isNotification) return null // e.g. notifications/initialized, notifications/cancelled
      return fail(id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`)
  }
}

/** Handles a single message or a JSON-RPC batch (accepted for older clients). */
export async function handlePayload(payload: unknown, options: ServerOptions): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((m) => handleMessage(m, options)))).filter((r): r is JsonRpcResponse => r !== null)
    return responses.length ? responses : null
  }
  return handleMessage(payload, options)
}

export const parseError = (): JsonRpcResponse => fail(null, PARSE_ERROR, 'Parse error')
