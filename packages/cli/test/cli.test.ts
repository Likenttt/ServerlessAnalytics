import { serve } from '@hono/node-server'
import { createApp, createServices } from '@serverless-analytics/core'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { d1Database, fakeD1 } from '../../core/test/helpers.js'
import { main } from '../src/main.js'
import type { Runtime } from '../src/context.js'

const PASSWORD = 'correct horse battery'
let base = ''
let close: () => void
let configDir = ''

/** Plays the person in the browser: signs in and approves the code in the URL. */
async function approveInBrowser(url: string, deny = false) {
  const code = new URL(url).searchParams.get('code')!
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!
  await fetch(`${base}/api/cli/auth/${deny ? 'deny' : 'approve'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: base },
    body: JSON.stringify({ userCode: code }),
  })
}

let opened: string[] = []
const runtime = (env: Record<string, string> = {}): Runtime => ({
  env: { SA_CONFIG_DIR: configDir, ...env },
  fetch: (...args) => fetch(...args),
  sleep: () => new Promise((r) => setTimeout(r, 5)),
  openBrowser: (url) => {
    opened.push(url)
    void approveInBrowser(url)
  },
})

async function sa(argv: string[], env?: Record<string, string>) {
  let stdout = ''
  let stderr = ''
  const code = await main(argv, runtime(env), { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), isTTY: false })
  let json: any = null
  try {
    json = JSON.parse(stdout)
  } catch {}
  // Progress goes to stderr too; the error (if any) is the last line.
  const lastErr = stderr.trim().split('\n').at(-1) ?? ''
  let error: any = null
  try {
    error = JSON.parse(lastErr).error
  } catch {}
  return { code, stdout, stderr, json, error }
}

beforeAll(async () => {
  const d1 = fakeD1()
  const env = { ADMIN_PASSWORD: PASSWORD, DB: d1 }
  const app = createApp({
    services: () => createServices({ runtime: 'test', env, waitUntil: () => {}, openDatabase: () => d1Database(d1) }),
    env: () => env,
  })
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
  configDir = await mkdtemp(join(tmpdir(), 'sa-cli-'))
  // Initialize the database as a signed-in dashboard would.
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
  await fetch(`${base}/api/system/migrate`, { method: 'POST', headers: { cookie: login.headers.get('set-cookie')!.split(';')[0]! } })
})

afterAll(() => close?.())

describe('serverless-analytics-cli', () => {
  it('requires login and explains how', async () => {
    const r = await sa(['apps', 'list'])
    expect(r.code).toBe(3)
    expect(r.error.code).toBe('not_logged_in')
    expect((await sa(['nope'])).code).toBe(2)
  })

  it('logs in through the browser and stores the token privately', async () => {
    opened = []
    const r = await sa(['login', '--endpoint', base, '--name', 'test agent'])
    expect(r.code).toBe(0)
    expect(r.json).toMatchObject({ status: 'logged_in', endpoint: base, tokenName: 'test agent' })
    expect(opened[0]).toMatch(new RegExp(`^${base}/cli/authorize\\?code=[A-Z2-9]{4}-[A-Z2-9]{4}$`))
    expect(r.stderr).toContain(new URL(opened[0]!).searchParams.get('code'))
    const file = join(configDir, 'config.json')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.token).toMatch(/^sa_pat_/)
    expect((await stat(file)).mode & 0o777).toBe(0o600)

    const who = await sa(['whoami'])
    expect(who.json).toMatchObject({ endpoint: base, token: { name: 'test agent' }, system: { runtime: 'test' } })
  })

  it('configures an app: create, define events, sampling, schema mode', async () => {
    const created = await sa(['apps', 'create', 'Demo App'])
    expect(created.json.app).toMatchObject({ name: 'Demo App', schemaMode: 'permissive' })

    const def = await sa(['events', 'define', 'demo app', 'purchase', '--description', 'Paid', '--prop', 'plan:string:required', '--prop', 'amount:number'])
    expect(def.json.definition.properties).toEqual([
      { name: 'plan', type: 'string', required: true, description: '' },
      { name: 'amount', type: 'number', required: false, description: '' },
    ])
    expect((await sa(['events', 'update', 'Demo App', 'purchase', '--status', 'archived'])).json.definition.status).toBe('archived')
    await sa(['events', 'update', 'Demo App', 'purchase', '--status', 'active'])

    const sampling = await sa(['sampling', 'set', 'Demo App', '--rate', '50%', '--override', 'purchase=1', '--override', 'noise=0'])
    expect(sampling.json.sampling).toEqual({ mode: 'sampled', strategy: 'user', rate: 0.5, overrides: [{ event: 'purchase', rate: 1 }, { event: 'noise', rate: 0 }] })
    expect((await sa(['sampling', 'set', 'Demo App', '--mode', 'full', '--clear-overrides'])).json.sampling).toMatchObject({ mode: 'full', overrides: [] })

    expect((await sa(['apps', 'update', 'Demo App', '--schema-mode', 'strict'])).json.app.schemaMode).toBe('strict')
    expect((await sa(['apps', 'update', 'Demo App', '--schema-mode', 'loose'])).code).toBe(2)
  })

  it('sends events and queries them', async () => {
    const ok = await sa(['track', 'Demo App', 'purchase', '--prop', 'plan=pro', '--prop', 'amount=29', '--user', 'u1', '--channel', 'appstore'])
    expect(ok.json).toMatchObject({ accepted: 1, rejected: [] })
    const bad = await sa(['track', 'Demo App', 'purchase', '--prop', 'amount=1'])
    expect(bad.json.rejected[0].reason).toContain('plan')
    // Strict mode: undefined events are rejected until they're defined.
    expect((await sa(['track', 'Demo App', 'view', '--user', 'u2'])).json.rejected[0].reason).toContain('not defined')
    await sa(['events', 'define', 'Demo App', 'view'])
    expect((await sa(['track', 'Demo App', 'view', '--user', 'u2'])).json.accepted).toBe(1)

    expect((await sa(['query', 'events', 'Demo App', '--name', 'purchase'])).json.events[0]).toMatchObject({ name: 'purchase', channel: 'appstore', properties: { plan: 'pro', amount: 29 } })
    expect((await sa(['query', 'top', 'Demo App', '--by', 'channel'])).json.rows).toContainEqual({ value: 'appstore', events: 1, users: 1 })
    expect((await sa(['query', 'trend', 'Demo App', '--event', 'purchase', '--metric', 'sum:amount', '--range', '24h'])).json.series[0].total).toBe(29)
    expect((await sa(['query', 'overview', 'Demo App', '--range', '7d'])).json.totals.events).toBe(2)
    expect((await sa(['query', 'active', 'Demo App'])).json).toEqual({ dau: 2, wau: 2, mau: 2 })
    const funnel = await sa(['query', 'funnel', 'Demo App', '--step', 'purchase', '--step', 'view'])
    expect(funnel.json.steps.map((s: { users: number }) => s.users)).toEqual([1, 0])
    expect((await sa(['query', 'trend', 'Demo App', '--range', '1y'])).code).toBe(2)

    const human = await sa(['query', 'top', 'Demo App', '--by', 'name', '--human'])
    expect(human.stdout).toMatch(/NAME\s+EVENTS\s+USERS/)
  })

  it('prints integration snippets with the write key', async () => {
    const r = await sa(['snippet', 'Demo App', '--lang', 'kotlin'])
    expect(r.json.code).toContain(`Bearer ${r.json.writeKey}`)
    expect(r.json.code).toContain(`${base}/v1/batch`)
  })

  it('supports a two-step login for agents, and logout revokes the token', async () => {
    const started = await sa(['login', '--no-wait'])
    expect(started.json).toMatchObject({ status: 'pending', next: 'sa login --resume' })
    await approveInBrowser(started.json.url)
    const resumed = await sa(['login', '--resume'])
    expect(resumed.json.status).toBe('logged_in')

    const saved = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'))
    expect((await sa(['logout'])).json).toEqual({ status: 'logged_out', revoked: true })
    expect((await sa(['whoami'])).code).toBe(3)
    // The revoked token no longer works even if someone kept a copy.
    const reused = await sa(['whoami'], { SA_ENDPOINT: base, SA_TOKEN: saved.token })
    expect(reused.code).toBe(1)
    expect(reused.error.status).toBe(401)
  })

  it('reports a denied login', async () => {
    const started = await sa(['login', '--endpoint', base, '--no-wait'])
    await approveInBrowser(started.json.url, true)
    const r = await sa(['login', '--resume'])
    expect(r.code).toBe(1)
    expect(r.error.code).toBe('login_denied')
  })
})

describe('sa mcp (stdio)', () => {
  it('serves MCP tools over stdin/stdout with the saved login', async () => {
    const login = await sa(['login', '--endpoint', base, '--name', 'mcp stdio'])
    expect(login.code).toBe(0)
    const { PassThrough } = await import('node:stream')
    const { Context } = await import('../src/context.js')
    const { Args, parseArgs } = await import('../src/args.js')
    const { Output } = await import('../src/output.js')
    const { mcp } = await import('../src/commands/mcp.js')

    const input = new PassThrough()
    const lines: any[] = []
    const ctx = await Context.create(new Args(parseArgs([], new Set())), new Output(true, () => {}, () => {}), runtime())
    const done = mcp(ctx, { input, write: (l) => lines.push(JSON.parse(l)) })
    const send = (m: unknown) => input.write(JSON.stringify(m) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_apps', arguments: {} } })
    input.write('not json\n')
    input.end()
    await done

    const byId = Object.fromEntries(lines.filter((l) => l.id !== null).map((l) => [l.id, l]))
    expect(byId[1].result.serverInfo.name).toBe('serverless-analytics')
    expect(byId[2].result.tools.length).toBeGreaterThan(15)
    const apps = JSON.parse(byId[3].result.content[0].text).apps
    expect(apps.map((a: { name: string }) => a.name)).toContain('Demo App')
    expect(lines.find((l) => l.id === null)).toMatchObject({ error: { code: -32700 } })
    expect(lines).toHaveLength(4) // the notification gets no reply
  })
})
