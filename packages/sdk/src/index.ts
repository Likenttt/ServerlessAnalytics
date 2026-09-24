// Client for Serverless Analytics. Works in browsers, Electron and Node 18+.
// Events are queued (persisted in localStorage when available), sent in
// batches, retried with backoff and deduplicated server-side by event id.

export type Properties = Record<string, unknown>

export interface AnalyticsOptions {
  /** Base URL of your deployment, e.g. https://analytics.example.com */
  endpoint: string
  /** The app's write key (safe to ship in clients). */
  writeKey: string
  /** Send when this many events are queued. Default 20. */
  flushAt?: number
  /** Send queued events at least this often (ms). Default 5000. */
  flushInterval?: number
  /** Drop the oldest events beyond this many. Default 1000. */
  maxQueueSize?: number
  /** Platform reported with every event. Default "web" in browsers, otherwise unset. */
  platform?: string
  appVersion?: string
  /**
   * Acquisition / distribution channel (e.g. "appstore", "googleplay", "huawei").
   * In browsers it defaults to the first-touch utm_source, or the referring domain.
   */
  channel?: string
  /** Track a `$pageview` on load and on history navigation. Default false. */
  autoPageviews?: boolean
  /** Minutes of inactivity before a new session starts. Default 30. */
  sessionTimeout?: number
  /** Persist identity and queue in localStorage. Default true. */
  persist?: boolean
  fetch?: typeof fetch
  debug?: boolean
}

interface QueuedEvent {
  id: string
  name: string
  timestamp: number
  anonymousId: string
  userId?: string
  sessionId?: string
  properties: Properties
}

export interface Analytics {
  track(name: string, properties?: Properties): void
  page(properties?: Properties): void
  identify(userId: string): void
  /** Properties added to every subsequent event. */
  register(properties: Properties): void
  /** Forget the user (e.g. on logout): new anonymous id, empty queue. */
  reset(): void
  flush(): Promise<void>
  shutdown(): Promise<void>
  readonly anonymousId: string
  readonly userId: string | null
}

const MAX_BATCH = 100

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

function createStorage(enabled: boolean, prefix: string) {
  const memory = new Map<string, string>()
  const ls = (() => {
    if (!enabled) return null
    try {
      const s = globalThis.localStorage
      const probe = `${prefix}probe`
      s.setItem(probe, '1')
      s.removeItem(probe)
      return s
    } catch {
      return null
    }
  })()
  return {
    get<T>(key: string): T | null {
      try {
        const raw = ls ? ls.getItem(prefix + key) : (memory.get(key) ?? null)
        return raw === null ? null : (JSON.parse(raw) as T)
      } catch {
        return null
      }
    },
    set(key: string, value: unknown) {
      const raw = JSON.stringify(value)
      try {
        if (ls) ls.setItem(prefix + key, raw)
        else memory.set(key, raw)
      } catch {
        memory.set(key, raw)
      }
    },
    remove(key: string) {
      try {
        ls?.removeItem(prefix + key)
      } catch {}
      memory.delete(key)
    },
  }
}

export function createAnalytics(options: AnalyticsOptions): Analytics {
  const endpoint = options.endpoint.replace(/\/+$/, '')
  const flushAt = options.flushAt ?? 20
  const flushInterval = options.flushInterval ?? 5000
  const maxQueueSize = options.maxQueueSize ?? 1000
  const sessionTimeout = (options.sessionTimeout ?? 30) * 60_000
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
  const store = createStorage(options.persist ?? true, `sa:${options.writeKey.slice(-8)}:`)
  const log = (...args: unknown[]) => options.debug && console.log('[analytics]', ...args)

  let anonymousId = store.get<string>('anonymousId') ?? uuid()
  store.set('anonymousId', anonymousId)
  let userId = store.get<string>('userId')
  let superProperties = store.get<Properties>('super') ?? {}
  let queue = store.get<QueuedEvent[]>('queue') ?? []
  let session = store.get<{ id: string; last: number }>('session')
  let backoff = 0
  let retryAt = 0
  let inFlight: Promise<void> | null = null
  let closed = false

  const context = {
    platform: options.platform ?? (isBrowser ? 'web' : undefined),
    appVersion: options.appVersion,
    channel: options.channel ?? firstTouchChannel(),
    locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
  }

  // First touch wins: the channel that brought this visitor is kept across visits.
  function firstTouchChannel(): string | undefined {
    const stored = store.get<string>('channel')
    if (stored) return stored
    if (!isBrowser) return undefined
    let channel: string | undefined
    try {
      channel = new URLSearchParams(location.search).get('utm_source') ?? undefined
      if (!channel && document.referrer) {
        const host = new URL(document.referrer).hostname.replace(/^www\./, '')
        if (host && host !== location.hostname) channel = host
      }
    } catch {}
    if (channel) store.set('channel', channel.slice(0, 64))
    return channel?.slice(0, 64)
  }

  const save = () => store.set('queue', queue)

  const sessionId = () => {
    const now = Date.now()
    if (!session || now - session.last > sessionTimeout) session = { id: uuid(), last: now }
    else session.last = now
    store.set('session', session)
    return session.id
  }

  const enqueue = (name: string, properties: Properties = {}) => {
    if (closed) return
    queue.push({
      id: uuid(),
      name,
      timestamp: Date.now(),
      anonymousId,
      userId: userId ?? undefined,
      sessionId: sessionId(),
      properties: { ...superProperties, ...properties },
    })
    if (queue.length > maxQueueSize) queue = queue.slice(-maxQueueSize)
    save()
    if (queue.length >= flushAt) void flush()
  }

  const body = (events: QueuedEvent[], withKey = false) =>
    JSON.stringify({ ...(withKey ? { writeKey: options.writeKey } : {}), sentAt: Date.now(), context, events })

  async function send(): Promise<void> {
    while (queue.length > 0 && Date.now() >= retryAt) {
      const batch = queue.slice(0, MAX_BATCH)
      let status = 0
      try {
        const res = await doFetch(`${endpoint}/v1/batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.writeKey}` },
          body: body(batch),
          keepalive: batch.length <= 50,
        })
        status = res.status
        if (res.ok) {
          const result = (await res.json().catch(() => null)) as { rejected?: { index: number; reason: string }[] } | null
          if (result?.rejected?.length) log('rejected events', result.rejected)
        }
      } catch (error) {
        log('network error', error)
      }
      // 2xx: done. 4xx (except 429): the batch will never succeed, drop it.
      if ((status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 429)) {
        if (status >= 400) log(`batch dropped (HTTP ${status})`)
        const sent = new Set(batch.map((e) => e.id))
        queue = queue.filter((e) => !sent.has(e.id))
        save()
        backoff = 0
        retryAt = 0
      } else {
        backoff = Math.min(60_000, backoff ? backoff * 2 : 1000)
        retryAt = Date.now() + backoff * (0.8 + Math.random() * 0.4)
        log(`send failed (${status || 'network'}), retrying in ${backoff}ms`)
        return
      }
    }
  }

  function flush(): Promise<void> {
    if (!inFlight) inFlight = send().finally(() => (inFlight = null))
    return inFlight
  }

  // Page is going away: hand the queue to the browser, which delivers it even after unload.
  const beacon = () => {
    if (queue.length === 0 || typeof navigator === 'undefined' || !navigator.sendBeacon) return
    const batch = queue.slice(0, 50)
    const blob = new Blob([body(batch, true)], { type: 'text/plain' })
    if (navigator.sendBeacon(`${endpoint}/v1/batch`, blob)) {
      const sent = new Set(batch.map((e) => e.id))
      queue = queue.filter((e) => !sent.has(e.id))
      save()
    }
  }

  const timer = setInterval(() => void flush(), flushInterval)
  ;(timer as { unref?: () => void }).unref?.()

  if (isBrowser) {
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && beacon())
    window.addEventListener('pagehide', beacon)
    window.addEventListener('online', () => {
      retryAt = 0
      void flush()
    })
  }

  const page = (properties: Properties = {}) => {
    if (!isBrowser) return
    enqueue('$pageview', {
      path: location.pathname,
      title: document.title,
      referrer: document.referrer || undefined,
      ...properties,
    })
  }

  if (isBrowser && options.autoPageviews) {
    let lastPath = location.pathname
    const onNavigate = () => {
      if (location.pathname === lastPath) return
      lastPath = location.pathname
      page()
    }
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method]
      history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
        const result = original.apply(this, args)
        onNavigate()
        return result
      }
    }
    window.addEventListener('popstate', onNavigate)
    page()
  }

  if (queue.length > 0) void flush()

  return {
    track: enqueue,
    page,
    identify(id: string) {
      userId = id
      store.set('userId', id)
    },
    register(properties: Properties) {
      superProperties = { ...superProperties, ...properties }
      store.set('super', superProperties)
    },
    reset() {
      userId = null
      anonymousId = uuid()
      superProperties = {}
      session = null
      queue = []
      for (const key of ['userId', 'super', 'session', 'queue', 'channel']) store.remove(key)
      store.set('anonymousId', anonymousId)
    },
    flush,
    async shutdown() {
      closed = true
      clearInterval(timer)
      retryAt = 0
      await flush()
    },
    get anonymousId() {
      return anonymousId
    },
    get userId() {
      return userId
    },
  }
}
