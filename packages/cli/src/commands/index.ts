import type { Context } from '../context.js'
import { login, logout, migrate, tokens, whoami } from './auth.js'

export type Command = (ctx: Context) => Promise<void>

/** Keyed by "group sub" or "command". */
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  whoami,
  migrate,
  tokens,
}

const GLOBAL = `Global options:
  --json            JSON output (default when stdout isn't a terminal; --human forces tables)
  --endpoint URL    Deployment URL (else SA_ENDPOINT or the saved login)
  --token TOKEN     Access token (else SA_TOKEN or the saved login)
  --tz MINUTES      Timezone offset for charts, e.g. 480 for UTC+8 (default: local)
  -h, --help        Help for a command`

export const HELP: Record<string, string> = {
  '': `serverless-analytics-cli — manage and query Serverless Analytics

Usage: sa <command> [options]

Auth
  login [--endpoint URL] [--name NAME] [--no-open]   Authorize in the browser
  login --no-wait | --resume                        Two-step login for agents
  logout                                            Revoke and forget the token
  whoami                                            Endpoint, token and deployment status
  tokens [list|create <name>|revoke <id> --yes]     Manage access tokens
  migrate                                           Apply pending database migrations

${GLOBAL}

Exit codes: 0 ok · 1 API error · 2 usage error · 3 not logged in`,
}
