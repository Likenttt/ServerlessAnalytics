import { spawn } from 'node:child_process'
import { Args, UsageError, parseArgs } from './args.js'
import { ApiError, VERSION } from './client.js'
import { COMMANDS, HELP } from './commands/index.js'
import { Context, NotLoggedIn, type Runtime } from './context.js'
import { Output } from './output.js'

export const BOOLEAN_FLAGS = new Set(['json', 'human', 'help', 'version', 'yes', 'strict', 'resume', 'clear-overrides', 'archived', 'reveal'])

export const defaultRuntime: Runtime = {
  env: process.env,
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  openBrowser(url) {
    const cmd = process.env.BROWSER ?? (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open')
    const args = process.platform === 'win32' && !process.env.BROWSER ? ['/c', 'start', '', url] : [url]
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
    } catch {}
  },
}

/** Exit codes: 0 ok · 1 API/network error · 2 usage error · 3 not logged in. */
export async function main(argv: string[], runtime: Runtime = defaultRuntime, io?: { stdout?: (s: string) => void; stderr?: (s: string) => void; isTTY?: boolean }): Promise<number> {
  let parsed
  const stderr = io?.stderr ?? ((s: string) => process.stderr.write(s))
  try {
    parsed = parseArgs(argv, BOOLEAN_FLAGS)
  } catch (error) {
    stderr(`error: ${(error as Error).message}\n`)
    return 2
  }
  const args = new Args(parsed)
  const isTTY = io?.isTTY ?? Boolean(process.stdout.isTTY)
  const json = args.has('json') || (!isTTY && !args.has('human'))
  const out = new Output(json, io?.stdout, io?.stderr)

  if (args.has('version')) {
    out.result({ version: VERSION }, () => VERSION)
    return 0
  }
  const key = [args.positionals[0], args.positionals[1]].filter(Boolean).join(' ')
  const command = COMMANDS[key] ?? COMMANDS[args.positionals[0] ?? '']
  if (!command || args.has('help')) {
    const topic = args.positionals[0] && HELP[args.positionals[0]]
    stderr((topic ?? HELP['']!) + '\n')
    return command || !args.positionals[0] ? 0 : 2
  }

  try {
    const ctx = await Context.create(args, out, runtime)
    await command(ctx)
    return 0
  } catch (error) {
    const code = error instanceof NotLoggedIn ? 3 : error instanceof UsageError ? 2 : 1
    if (json) {
      const e = error as Partial<ApiError>
      stderr(JSON.stringify({ error: { code: error instanceof ApiError ? e.code : code === 3 ? 'not_logged_in' : code === 2 ? 'usage' : 'error', message: (error as Error).message, status: e.status } }) + '\n')
    } else {
      stderr(`error: ${(error as Error).message}\n`)
    }
    return code
  }
}
