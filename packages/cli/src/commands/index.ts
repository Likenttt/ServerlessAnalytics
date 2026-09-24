import type { Context } from '../context.js'
import { appsCreate, appsDelete, appsGet, appsList, appsRotateKey, appsUpdate, eventsDefine, eventsDelete, eventsList, eventsUpdate, samplingGet, samplingSet } from './apps.js'
import { login, logout, migrate, tokens, whoami } from './auth.js'

export type Command = (ctx: Context) => Promise<void>

/** Keyed by "group sub" or "command". */
export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  whoami,
  migrate,
  tokens,
  apps: appsList,
  'apps list': appsList,
  'apps create': appsCreate,
  'apps get': appsGet,
  'apps update': appsUpdate,
  'apps rotate-key': appsRotateKey,
  'apps delete': appsDelete,
  'sampling get': samplingGet,
  'sampling set': samplingSet,
  'events list': eventsList,
  'events define': eventsDefine,
  'events update': eventsUpdate,
  'events delete': eventsDelete,
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

Configure (<app> is an app id or name)
  apps list | get <app> [--reveal]                  List apps / show one (with write key)
  apps create <name> [--strict] [--retention-days N]
  apps update <app> [--name N] [--schema-mode permissive|strict] [--retention-days N]
  apps rotate-key <app> --yes | apps delete <app> --yes
  events list <app>                                 Definitions and undefined events seen
  events define <app> <event> [--description D] [--prop name:type[:required][:desc]]…
  events update <app> <event> [--description D] [--status active|archived] [--prop …]
  events delete <app> <event> --yes
  sampling get <app>
  sampling set <app> [--mode full|sampled] [--strategy user|event] [--rate 0.1|10%]
                     [--override event=rate]… [--remove-override event] [--clear-overrides]

${GLOBAL}

Exit codes: 0 ok · 1 API error · 2 usage error · 3 not logged in`,
}
