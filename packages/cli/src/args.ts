// A small argv parser: positionals, --flag value, --flag=value, repeated
// flags (collected as arrays) and boolean switches.

export interface Parsed {
  positionals: string[]
  flags: Map<string, string[]>
  switches: Set<string>
}

export function parseArgs(argv: string[], booleanFlags: ReadonlySet<string>): Parsed {
  const positionals: string[] = []
  const flags = new Map<string, string[]>()
  const switches = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') {
      switches.add('help')
      continue
    }
    if (!arg.startsWith('--') || arg === '--') {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = arg.slice(2, eq === -1 ? undefined : eq)
    if (eq === -1 && (booleanFlags.has(name) || name.startsWith('no-'))) {
      switches.add(name)
      continue
    }
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (value === undefined) throw new UsageError(`--${name} needs a value`)
    flags.set(name, [...(flags.get(name) ?? []), value])
  }
  return { positionals, flags, switches }
}

export class UsageError extends Error {}

export class Args {
  constructor(private readonly p: Parsed) {}
  get positionals() {
    return this.p.positionals
  }
  /** Drops the first n positionals (the command words). */
  shift(n: number): Args {
    return new Args({ ...this.p, positionals: this.p.positionals.slice(n) })
  }
  has(name: string) {
    return this.p.switches.has(name)
  }
  get(name: string): string | undefined {
    const v = this.p.flags.get(name)
    return v?.[v.length - 1]
  }
  all(name: string): string[] {
    return this.p.flags.get(name) ?? []
  }
  number(name: string): number | undefined {
    const v = this.get(name)
    if (v === undefined) return undefined
    const n = Number(v)
    if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number`)
    return n
  }
  required(index: number, label: string): string {
    const v = this.p.positionals[index]
    if (!v) throw new UsageError(`Missing <${label}>`)
    return v
  }
}

/** `key=value` → typed value (numbers, booleans, null); `key:=<json>` → raw JSON. */
export function parseKeyValue(input: string): [string, unknown] {
  const json = input.indexOf(':=')
  const eq = input.indexOf('=')
  if (json > 0 && json < eq) {
    const raw = input.slice(json + 2)
    try {
      return [input.slice(0, json), JSON.parse(raw)]
    } catch {
      throw new UsageError(`Invalid JSON in ${input}`)
    }
  }
  if (eq <= 0) throw new UsageError(`Expected key=value, got "${input}"`)
  const key = input.slice(0, eq)
  const value = input.slice(eq + 1)
  if (value === 'true' || value === 'false') return [key, value === 'true']
  if (value === 'null') return [key, null]
  if (value.trim() !== '' && Number.isFinite(Number(value))) return [key, Number(value)]
  return [key, value]
}
