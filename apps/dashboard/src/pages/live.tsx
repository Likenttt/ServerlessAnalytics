import type { StoredEvent } from '@serverless-analytics/core/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon, PauseIcon, PlayIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Button, Card, CodeBlock, EmptyState, Select, Skeleton, cx } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatRelative, formatValue } from '../lib/format'
import { useSearchParams } from '../lib/url'

const PAGE = 50

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

function EventRow({ event, now }: { event: StoredEvent; now: number }) {
  const [open, setOpen] = useState(false)
  const context = {
    platform: event.platform,
    os: event.os,
    osVersion: event.osVersion,
    browser: event.browser,
    appVersion: event.appVersion,
    device: event.device,
    country: event.country,
    locale: event.locale,
  }
  const detail = JSON.stringify(
    {
      id: event.id,
      name: event.name,
      distinctId: event.distinctId,
      userId: event.userId,
      sessionId: event.sessionId,
      timestamp: new Date(event.timestamp).toISOString(),
      receivedAt: new Date(event.receivedAt).toISOString(),
      properties: event.properties,
      context: Object.fromEntries(Object.entries(context).filter(([, v]) => v !== null)),
    },
    null,
    2,
  )
  const where = [event.platform && formatValue('platform', event.platform), event.os, event.country && formatValue('country', event.country)].filter(Boolean).join(' · ')
  const propCount = Object.keys(event.properties).length

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="grid w-full grid-cols-[16px_minmax(0,1fr)_64px] items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-subtle sm:grid-cols-[16px_96px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_64px]"
      >
        <ChevronRightIcon size={14} className={cx('text-muted transition-transform', open && 'rotate-90')} />
        <time dateTime={new Date(event.timestamp).toISOString()} title={formatDateTime(event.timestamp)} className="hidden text-muted tabular sm:block">
          {formatRelative(event.timestamp, now)}
        </time>
        <span className="truncate font-mono text-[12.5px] font-medium">{event.name}</span>
        <span className="hidden truncate font-mono text-[12px] text-muted sm:block" title={event.distinctId}>
          {event.distinctId}
        </span>
        <span className="hidden truncate text-muted sm:block">{where || '—'}</span>
        <span className="text-right text-xs text-muted tabular">{propCount ? `${propCount} prop${propCount === 1 ? '' : 's'}` : ''}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 sm:pl-[44px]">
          <CodeBlock code={detail} />
        </div>
      )}
    </li>
  )
}

export function LivePage({ appId }: { appId: string }) {
  const { params, set } = useSearchParams()
  const name = params.get('event') ?? ''
  const [paused, setPaused] = useState(false)
  const [older, setOlder] = useState<StoredEvent[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const now = useNow(10_000)

  useEffect(() => {
    setOlder([])
    setExhausted(false)
  }, [name])

  const latest = useQuery({
    queryKey: ['events', appId, 'live', name],
    queryFn: () => api.events(appId, { limit: PAGE, name }),
    refetchInterval: paused ? false : 3000,
  })
  const definitions = useQuery({ queryKey: ['definitions', appId], queryFn: () => api.definitions(appId) })
  const eventNames = useMemo(() => {
    const d = definitions.data
    return d ? [...new Set([...d.definitions.map((x) => x.name), ...d.undefinedEvents.map((x) => x.name)])].sort() : []
  }, [definitions.data])

  const events = useMemo(() => {
    const seen = new Set<string>()
    return [...(latest.data?.events ?? []), ...older].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  }, [latest.data, older])

  const loadOlder = async () => {
    const last = events[events.length - 1]
    if (!last) return
    setLoadingOlder(true)
    try {
      const res = await api.events(appId, { limit: PAGE, name, before: last.timestamp })
      setOlder((o) => [...o, ...res.events])
      if (res.events.length < PAGE) setExhausted(true)
    } finally {
      setLoadingOlder(false)
    }
  }

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Select aria-label="Event" value={name} onChange={(e) => set('event', e.target.value || null)} className="min-w-44">
          <option value="">All events</option>
          {eventNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Button onClick={() => setPaused(!paused)} icon={paused ? <PlayIcon /> : <PauseIcon />} aria-pressed={!paused}>
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <span className="ml-auto flex items-center gap-2 text-[13px] text-muted" aria-live="polite">
          <span
            className={cx('h-2 w-2 rounded-full', paused ? 'bg-border-strong' : 'bg-[var(--success)] [animation:pulse-dot_1.6s_ease-in-out_infinite]')}
            aria-hidden="true"
          />
          {paused ? 'Paused' : 'Live · refreshing every 3s'}
        </span>
      </div>

      {latest.isPending ? (
        <Card className="flex flex-col gap-2 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </Card>
      ) : events.length === 0 ? (
        <EmptyState title="No events yet" description="Events appear here within seconds of being sent." />
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[16px_96px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_64px] gap-3 border-b border-border bg-subtle px-4 py-2 text-xs font-medium text-muted sm:grid">
            <span />
            <span>Time</span>
            <span>Event</span>
            <span>User</span>
            <span>Source</span>
            <span className="text-right">Properties</span>
          </div>
          <ul>
            {events.map((e) => (
              <EventRow key={e.id} event={e} now={now} />
            ))}
          </ul>
          {!exhausted && events.length >= PAGE && (
            <div className="flex justify-center border-t border-border p-3">
              <Button variant="tertiary" onClick={loadOlder} loading={loadingOlder}>
                Load older events
              </Button>
            </div>
          )}
        </Card>
      )}
    </Page>
  )
}
