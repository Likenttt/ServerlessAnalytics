import { describe, expect, it, vi } from 'vitest'
import { createAnalytics } from '../src/index'

function mockFetch(statuses: number[]) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> })
    const status = statuses.shift() ?? 200
    return new Response(JSON.stringify({ ok: true, accepted: 1, rejected: [] }), { status })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

const base = { endpoint: 'https://a.test/', writeKey: 'wk_test_1234567890', persist: false, flushInterval: 60_000 }

describe('sdk', () => {
  it('batches events with identity, session and super properties', async () => {
    const { fn, calls } = mockFetch([200])
    const a = createAnalytics({ ...base, fetch: fn, appVersion: '1.2.3', channel: 'huawei' })
    a.register({ plan: 'pro' })
    a.track('one', { x: 1 })
    a.identify('user-1')
    a.track('two')
    await a.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://a.test/v1/batch')
    expect(calls[0]!.headers.authorization).toBe('Bearer wk_test_1234567890')
    const [e1, e2] = calls[0]!.body.events
    expect(e1).toMatchObject({ name: 'one', properties: { plan: 'pro', x: 1 }, anonymousId: a.anonymousId })
    expect(e1.userId).toBeUndefined()
    expect(e2).toMatchObject({ name: 'two', userId: 'user-1' })
    expect(e1.sessionId).toBe(e2.sessionId)
    expect(calls[0]!.body.context).toMatchObject({ appVersion: '1.2.3', channel: 'huawei' })
    expect(typeof calls[0]!.body.sentAt).toBe('number')
    await a.shutdown()
  })

  it('keeps events on server errors and retries after backoff', async () => {
    vi.useFakeTimers()
    const { fn, calls } = mockFetch([503, 200])
    const a = createAnalytics({ ...base, fetch: fn })
    a.track('e')
    await a.flush()
    await a.flush() // still backing off: no request
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    await a.flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.body.events[0].id).toBe(calls[0]!.body.events[0].id) // same id → deduplicated server-side
    await a.flush()
    expect(calls).toHaveLength(2)
    vi.useRealTimers()
    await a.shutdown()
  })

  it('drops batches the server rejects as invalid', async () => {
    const { fn, calls } = mockFetch([401, 200])
    const a = createAnalytics({ ...base, fetch: fn })
    a.track('e')
    await a.flush()
    await a.flush()
    expect(calls).toHaveLength(1)
    await a.shutdown()
  })

  it('flushes automatically at flushAt and resets identity', async () => {
    const { fn, calls } = mockFetch([])
    const a = createAnalytics({ ...base, fetch: fn, flushAt: 2 })
    const anon = a.anonymousId
    a.identify('u')
    a.track('a')
    a.track('b')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    a.reset()
    expect(a.userId).toBeNull()
    expect(a.anonymousId).not.toBe(anon)
    await a.shutdown()
  })
})
