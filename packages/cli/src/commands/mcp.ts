import { handlePayload, parseError, type Api } from '@serverless-analytics/mcp'
import { createInterface } from 'node:readline'
import type { Context } from '../context.js'

/**
 * sa mcp — a local MCP server over stdio for clients that launch servers as
 * processes (Claude Desktop, Cursor, …). Uses the `sa login` credentials (or
 * SA_ENDPOINT / SA_TOKEN). Messages are newline-delimited JSON-RPC; stdout
 * carries only protocol messages, logs go to stderr.
 */
export async function mcp(ctx: Context, io: { input?: NodeJS.ReadableStream; write?: (line: string) => void } = {}) {
  const client = ctx.client()
  const api: Api = {
    endpoint: client.endpoint,
    request: (method, path, body) => client.request(method, path, body),
    ingest: (writeKey, body) => client.request('POST', '/v1/batch', body, { auth: false, headers: { authorization: `Bearer ${writeKey}` } }),
  }
  const write = io.write ?? ((line: string) => process.stdout.write(line + '\n'))
  const log = (message: string) => {
    process.stderr.write(message + '\n')
  }
  log(`serverless-analytics MCP server (stdio) for ${client.endpoint}`)

  const lines = createInterface({ input: io.input ?? process.stdin, crlfDelay: Infinity })
  const inFlight = new Set<Promise<unknown>>()
  for await (const line of lines) {
    if (!line.trim()) continue
    let payload: unknown
    try {
      payload = JSON.parse(line)
    } catch {
      write(JSON.stringify(parseError()))
      continue
    }
    // Requests are handled concurrently; each response is written when ready.
    const task: Promise<void> = handlePayload(payload, { api, tzOffset: ctx.tz, log })
      .then((response) => {
        if (response !== null) write(JSON.stringify(response))
      })
      .catch((error) => log(`[mcp] ${(error as Error).message}`))
      .finally(() => {
        inFlight.delete(task)
      })
    inFlight.add(task)
  }
  await Promise.all(inFlight)
}

