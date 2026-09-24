// Lightweight error tracking: `$error` events carry { type, message, stack,
// fatal, handled }. At ingest we cap their size and add a `$fingerprint` so
// occurrences of the same problem group together.

export const ERROR_EVENT = '$error'
const MAX_MESSAGE = 1000
const MAX_STACK = 6000

/** FNV-1a, 32-bit: small, synchronous and stable across runtimes. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Replace values that vary between occurrences (ids, numbers, quoted values). */
function normalizeMessage(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, '0x?')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\d+/g, '0')
    .replace(/(["'`]).{0,200}?\1/g, '$1…$1')
    .trim()
}

/** First stack line that points at code, without line/column numbers. */
function topFrame(stack: string): string {
  const line = stack
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^at |@|\.(swift|kt|java|js|ts|mjs|dart)\b/.test(l))
  return line ? line.replace(/:\d+(:\d+)?\)?$/, '').replace(/\?.*$/, '') : ''
}

export function prepareErrorProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props }
  const message = typeof props.message === 'string' ? props.message.slice(0, MAX_MESSAGE) : String(props.message ?? 'Unknown error')
  const stack = typeof props.stack === 'string' ? props.stack.slice(0, MAX_STACK) : undefined
  const type = typeof props.type === 'string' ? props.type.slice(0, 128) : 'Error'
  out.message = message
  out.type = type
  if (stack !== undefined) out.stack = stack
  out.$fingerprint = fnv1a(`${type}|${normalizeMessage(message)}|${stack ? topFrame(stack) : ''}`)
  return out
}
