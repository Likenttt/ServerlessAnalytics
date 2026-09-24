// Humans get tables; agents and pipes get JSON. JSON is used when --json is
// passed or stdout isn't a terminal (override with --human).

export class Output {
  constructor(
    readonly json: boolean,
    private readonly out: (s: string) => void = (s) => process.stdout.write(s),
    private readonly err: (s: string) => void = (s) => process.stderr.write(s),
  ) {}

  /** The command's result: JSON as-is, or the human renderer. */
  result(data: unknown, human?: () => string) {
    if (this.json || !human) this.out(JSON.stringify(data, null, this.json ? 2 : 2) + '\n')
    else this.out(human() + '\n')
  }

  /** Progress and hints; always stderr so stdout stays machine-readable. */
  info(message: string) {
    this.err(message + '\n')
  }
}

export function table(rows: Record<string, unknown>[], columns: { key: string; label: string; align?: 'right' }[]): string {
  if (rows.length === 0) return '(none)'
  const cells = rows.map((r) => columns.map((c) => format(r[c.key])))
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((row) => row[i]!.length)))
  const line = (values: string[]) =>
    values.map((v, i) => (columns[i]!.align === 'right' ? v.padStart(widths[i]!) : v.padEnd(widths[i]!))).join('  ').trimEnd()
  return [line(columns.map((c) => c.label)), line(widths.map((w) => '─'.repeat(w))), ...cells.map(line)].join('\n')
}

export function format(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export const date = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16)
export const percent = (n: number) => `${(n * 100).toFixed(1)}%`
