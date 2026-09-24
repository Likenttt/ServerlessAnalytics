import { Args, UsageError } from './args.js'
import { Client } from './client.js'
import { loadConfig, resolveAuth, saveConfig, type StoredConfig } from './config.js'
import type { Output } from './output.js'

export interface Runtime {
  env: NodeJS.ProcessEnv
  fetch: typeof fetch
  openBrowser(url: string): void
  sleep(ms: number): Promise<void>
}

export class NotLoggedIn extends Error {
  constructor() {
    super('Not logged in. Run `sa login --endpoint https://your-deployment`, or set SA_ENDPOINT and SA_TOKEN.')
  }
}

export class Context {
  constructor(
    readonly args: Args,
    readonly out: Output,
    readonly runtime: Runtime,
    public config: StoredConfig,
  ) {}

  static async create(args: Args, out: Output, runtime: Runtime) {
    return new Context(args, out, runtime, await loadConfig(runtime.env))
  }

  get auth() {
    return resolveAuth(this.config, { endpoint: this.args.get('endpoint'), token: this.args.get('token') }, this.runtime.env)
  }

  /** An authenticated client, or NotLoggedIn. */
  client(): Client {
    const { endpoint, token } = this.auth
    if (!endpoint || !token) throw new NotLoggedIn()
    return new Client(endpoint, token, this.runtime.fetch)
  }

  anonymousClient(endpoint: string): Client {
    return new Client(endpoint, undefined, this.runtime.fetch)
  }

  async save(config: StoredConfig) {
    this.config = config
    await saveConfig(config, this.runtime.env)
  }

  /** Timezone offset in minutes east of UTC (--tz, else the local zone). */
  get tz(): number {
    const tz = this.args.number('tz')
    return tz ?? -new Date().getTimezoneOffset()
  }

  requireYes(what: string) {
    if (!this.args.has('yes')) throw new UsageError(`${what} Re-run with --yes to confirm.`)
  }
}
