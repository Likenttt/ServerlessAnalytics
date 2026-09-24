import { UsageError } from '../args.js'
import { ApiError } from '../client.js'
import type { Context } from '../context.js'
import { table } from '../output.js'

interface StartResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

type PollResponse = { status: 'pending' | 'expired' | 'denied' } | { status: 'approved'; token: string; name: string }

function normalizeEndpoint(raw: string): string {
  const url = raw.includes('://') ? raw : `https://${raw}`
  try {
    const u = new URL(url)
    return u.origin
  } catch {
    throw new UsageError(`Invalid endpoint: ${raw}`)
  }
}

/**
 * sa login [--endpoint URL] [--name NAME] [--no-open] [--no-wait | --resume]
 *
 * Opens the dashboard to approve this CLI. Agents that can't block while a
 * person approves can split it: `--no-wait` prints the link and code and
 * exits; `--resume` waits for the approval later.
 */
export async function login(ctx: Context) {
  if (ctx.args.has('resume')) return waitForApproval(ctx)

  const endpoint = normalizeEndpoint(ctx.args.get('endpoint') ?? ctx.runtime.env.SA_ENDPOINT ?? ctx.config.endpoint ?? '')
  if (!ctx.args.get('endpoint') && !ctx.runtime.env.SA_ENDPOINT && !ctx.config.endpoint) {
    throw new UsageError('Pass --endpoint https://your-deployment the first time you log in.')
  }
  const name = ctx.args.get('name') ?? `CLI on ${ctx.runtime.env.HOSTNAME ?? ctx.runtime.env.COMPUTERNAME ?? 'this machine'}`
  const start = await ctx.anonymousClient(endpoint).post<StartResponse>('/api/cli/auth/start', { name })
  await ctx.save({
    ...ctx.config,
    pending: {
      endpoint,
      deviceCode: start.deviceCode,
      userCode: start.userCode,
      verificationUri: start.verificationUriComplete,
      expiresAt: Date.now() + start.expiresIn * 1000,
      interval: start.interval,
    },
  })

  if (ctx.args.has('no-wait')) {
    ctx.out.result(
      { status: 'pending', url: start.verificationUriComplete, code: start.userCode, expiresIn: start.expiresIn, next: 'sa login --resume' },
      () =>
        `Open ${start.verificationUriComplete}\nand confirm the code ${start.userCode}. Then run: sa login --resume`,
    )
    return
  }

  ctx.out.info(`\nOpen this link to authorize the CLI:\n\n  ${start.verificationUriComplete}\n\nand check that it shows the code  ${start.userCode}\n`)
  if (!ctx.args.has('no-open')) ctx.runtime.openBrowser(start.verificationUriComplete)
  return waitForApproval(ctx)
}

async function waitForApproval(ctx: Context) {
  const pending = ctx.config.pending
  if (!pending) throw new UsageError('No login in progress. Run `sa login` first.')
  const client = ctx.anonymousClient(pending.endpoint)
  ctx.out.info('Waiting for approval in the browser…')
  while (Date.now() < pending.expiresAt) {
    const res = await client.post<PollResponse>('/api/cli/auth/poll', { deviceCode: pending.deviceCode })
    if (res.status === 'approved') {
      await ctx.save({ endpoint: pending.endpoint, token: res.token, tokenName: res.name })
      ctx.out.result({ status: 'logged_in', endpoint: pending.endpoint, tokenName: res.name }, () => `✓ Logged in to ${pending.endpoint} as "${res.name}"`)
      return
    }
    if (res.status !== 'pending') {
      const { pending: _, ...rest } = ctx.config
      await ctx.save(rest)
      throw new ApiError(401, `login_${res.status}`, res.status === 'denied' ? 'The request was denied in the browser.' : 'The login request expired. Run `sa login` again.')
    }
    await ctx.runtime.sleep(pending.interval * 1000)
  }
  throw new ApiError(401, 'login_expired', 'The login request expired. Run `sa login` again.')
}

/** sa logout — revokes this CLI's token on the server and forgets it locally. */
export async function logout(ctx: Context) {
  const { endpoint, token } = ctx.auth
  let revoked = false
  if (endpoint && token) {
    try {
      const client = ctx.client()
      const { token: current } = await client.get<{ token: { id: string } | null }>('/api/tokens/current')
      if (current) {
        await client.delete(`/api/tokens/${current.id}`)
        revoked = true
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
    }
  }
  await ctx.save({})
  ctx.out.result({ status: 'logged_out', revoked }, () => (revoked ? '✓ Logged out and revoked the token' : '✓ Logged out'))
}

/** sa whoami — endpoint, token and deployment status. */
export async function whoami(ctx: Context) {
  const client = ctx.client()
  const [{ token }, system] = await Promise.all([
    client.get<{ token: { id: string; name: string; prefix: string; createdAt: number } | null }>('/api/tokens/current'),
    client.get<{ version: string; runtime: string; database: { driver: string }; queue: { driver: string }; kv: { driver: string }; migrations: { pending: string[] } }>('/api/system'),
  ])
  const data = { endpoint: client.endpoint, token, system }
  ctx.out.result(data, () =>
    [
      `Endpoint   ${client.endpoint}`,
      `Token      ${token ? `${token.name} (${token.prefix}…)` : 'ADMIN_API_TOKEN'}`,
      `Runtime    ${system.runtime} · v${system.version}`,
      `Storage    ${system.database.driver} · kv ${system.kv.driver} · queue ${system.queue.driver}`,
      system.migrations.pending.length ? `Migrations pending: ${system.migrations.pending.join(', ')} (run: sa migrate)` : 'Schema     up to date',
    ].join('\n'),
  )
}

export async function migrate(ctx: Context) {
  const res = await ctx.client().post<{ ran: string[]; applied: string[]; pending: string[] }>('/api/system/migrate')
  ctx.out.result(res, () => (res.ran.length ? `✓ Applied ${res.ran.join(', ')}` : '✓ Schema already up to date'))
}

export async function tokens(ctx: Context) {
  const sub = ctx.args.positionals[0] ?? 'list'
  const client = ctx.client()
  if (sub === 'list') {
    const res = await client.get<{ tokens: { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }[] }>('/api/tokens')
    ctx.out.result(res, () =>
      table(
        res.tokens.map((t) => ({ ...t, created: new Date(t.createdAt).toISOString().slice(0, 10), used: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString().slice(0, 10) : 'never' })),
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'NAME' },
          { key: 'prefix', label: 'PREFIX' },
          { key: 'created', label: 'CREATED' },
          { key: 'used', label: 'LAST USED' },
        ],
      ),
    )
  } else if (sub === 'create') {
    const name = ctx.args.required(1, 'name')
    const res = await client.post<{ token: { id: string }; secret: string }>('/api/tokens', { name })
    ctx.out.result(res, () => `${res.secret}\n\nStore it now; it won't be shown again. Use it as SA_TOKEN.`)
  } else if (sub === 'revoke') {
    const id = ctx.args.required(1, 'token-id')
    ctx.requireYes(`This revokes token ${id}.`)
    ctx.out.result(await client.delete(`/api/tokens/${encodeURIComponent(id)}`), () => `✓ Revoked ${id}`)
  } else throw new UsageError(`Unknown command: tokens ${sub}`)
}
