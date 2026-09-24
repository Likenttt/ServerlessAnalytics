import type { ErrorGroup, StoredEvent, TopResponse } from '@serverless-analytics/core/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'wouter'
import { TimeSeriesChart } from '../components/chart'
import { AddFilter, FilterChips, RangeSelect, useRange } from '../components/filters'
import { ChevronRightIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Badge, Card, CodeBlock, EmptyState, Skeleton, cx } from '../components/ui'
import { api } from '../lib/api'
import { formatCompact, formatDateTime, formatNumber, formatRelative, formatValue } from '../lib/format'
import { useFilters } from '../lib/url'

function Toolbar({ appId }: { appId: string }) {
  const { range } = useRange()
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <RangeSelect />
      <AddFilter appId={appId} range={range} event="$error" />
      <FilterChips />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {value === null ? <Skeleton className="h-7 w-16" /> : <span className="text-xl font-semibold tracking-tight">{value}</span>}
    </div>
  )
}

const errorTitle = (g: Pick<ErrorGroup, 'message'>) => g.message?.split('\n')[0] || 'Unknown error'

export function ErrorsPage({ appId }: { appId: string }) {
  const { range } = useRange()
  const { raw: f } = useFilters()
  const errors = useQuery({
    queryKey: ['errors', appId, range, f],
    queryFn: () => api.errors(appId, { range, f }),
    placeholderData: keepPreviousData,
  })
  const data = errors.data
  const qs = range !== '7d' ? `?range=${range}` : ''

  return (
    <Page title="Errors" description="Errors reported with captureError() or as $error events, grouped by type, message and stack.">
      <Toolbar appId={appId} />
      <Card className="mb-6 grid grid-cols-3 divide-x divide-border overflow-hidden">
        <Stat label="Errors" value={data ? formatNumber(data.totals.events) : null} />
        <Stat label="Affected users" value={data ? formatNumber(data.totals.users) : null} />
        <Stat label="Distinct issues" value={data ? formatNumber(data.groups.length) : null} />
      </Card>

      {!data ? (
        <Skeleton className="h-48" />
      ) : data.groups.length === 0 ? (
        <EmptyState
          title="No errors in this period"
          description={
            <>
              Report errors with <code className="font-mono text-fg">analytics.captureError(err)</code>, enable{' '}
              <code className="font-mono text-fg">captureErrors: true</code> in the Web SDK, or send a{' '}
              <code className="font-mono text-fg">$error</code> event with type, message and stack.
            </>
          }
        />
      ) : (
        <Card className={cx('overflow-x-auto transition-opacity', errors.isFetching && errors.isPlaceholderData && 'opacity-50')}>
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-subtle text-left text-xs text-muted">
                <th className="h-10 px-4 font-medium">Issue</th>
                <th className="h-10 px-4 text-right font-medium">Events</th>
                <th className="h-10 px-4 text-right font-medium">Users</th>
                <th className="h-10 px-4 text-right font-medium">Last seen</th>
                <th className="h-10 w-8" />
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.fingerprint} className="border-b border-border last:border-b-0 hover:bg-subtle">
                  <td className="max-w-0 px-4 py-2.5">
                    <Link href={`/apps/${appId}/errors/${g.fingerprint}${qs}`} className="block">
                      <span className="block truncate font-medium">{errorTitle(g)}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        <span className="font-mono">{g.type ?? 'Error'}</span>·<span>first seen {formatRelative(g.firstSeen)}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 text-right font-medium tabular">{formatCompact(g.events)}</td>
                  <td className="px-4 text-right tabular">{formatCompact(g.users)}</td>
                  <td className="px-4 text-right text-muted" title={formatDateTime(g.lastSeen)}>
                    {formatRelative(g.lastSeen)}
                  </td>
                  <td className="pr-3 text-muted">
                    <ChevronRightIcon size={14} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  )
}

function Breakdown({ title, by, rows }: { title: string; by: string; rows: TopResponse['rows'] }) {
  const total = rows.reduce((a, r) => a + r.events, 0)
  return (
    <Card className="flex flex-col">
      <h3 className="border-b border-border px-4 py-3 text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-1 p-3 text-[13px]">
        {rows.length === 0 && <li className="text-muted">—</li>}
        {rows.map((r) => (
          <li key={r.value ?? '__none'} className="flex items-center justify-between gap-3">
            <span className={cx('truncate', r.value === null && 'text-muted italic')}>{formatValue(by, r.value)}</span>
            <span className="text-muted tabular">{total ? Math.round((r.events / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Sample({ event }: { event: StoredEvent }) {
  const [open, setOpen] = useState(false)
  const { stack, message, type, $fingerprint: _, ...rest } = event.properties as Record<string, unknown>
  const where = [event.platform && formatValue('platform', event.platform), event.appVersion, event.os, event.country && formatValue('country', event.country)]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-subtle">
        <ChevronRightIcon size={14} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-90')} />
        <time className="w-24 shrink-0 text-muted" title={formatDateTime(event.timestamp)}>
          {formatRelative(event.timestamp)}
        </time>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{event.distinctId}</span>
        <span className="hidden truncate text-muted sm:block">{where}</span>
        {rest.fatal === true && <Badge tone="red">Fatal</Badge>}
        {rest.handled === false && <Badge tone="amber">Unhandled</Badge>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4 sm:pl-10">
          <CodeBlock label={`${String(type ?? 'Error')}: ${String(message ?? '')}`.slice(0, 200)} code={typeof stack === 'string' ? stack : 'No stack trace'} />
          {Object.keys(rest).length > 0 && <CodeBlock label="Properties" code={JSON.stringify(rest, null, 2)} />}
        </div>
      )}
    </li>
  )
}

export function ErrorDetailPage({ appId, fingerprint }: { appId: string; fingerprint: string }) {
  const { range } = useRange()
  const { raw: f } = useFilters()
  const detail = useQuery({
    queryKey: ['error', appId, fingerprint, range, f],
    queryFn: () => api.errorDetail(appId, fingerprint, { range, f }),
    placeholderData: keepPreviousData,
  })
  const d = detail.data
  const g = d?.group

  return (
    <Page>
      <Link href={`/apps/${appId}/errors${range !== '7d' ? `?range=${range}` : ''}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronRightIcon size={14} className="rotate-180" />
        All errors
      </Link>
      <div className="mb-6 flex flex-col gap-1.5">
        <span className="font-mono text-[13px] text-danger">{g?.type ?? (d ? 'Error' : '…')}</span>
        <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{g ? errorTitle(g) : d ? 'No occurrences in this period' : '…'}</h1>
        {g && (
          <p className="text-[13px] text-muted">
            First seen {formatDateTime(g.firstSeen)} · last seen {formatRelative(g.lastSeen)}
          </p>
        )}
      </div>
      <Toolbar appId={appId} />

      <Card className="mb-6 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
          <Stat label="Occurrences" value={d ? formatNumber(g?.events ?? 0) : null} />
          <Stat label="Affected users" value={d ? formatNumber(g?.users ?? 0) : null} />
        </div>
        <div className="px-3 py-4">
          {d ? (
            <TimeSeriesChart
              label="Occurrences over time"
              height={180}
              buckets={d.buckets}
              interval={d.buckets.length > 1 && d.buckets[1]! - d.buckets[0]! < 86_400_000 ? 'hour' : 'day'}
              series={[{ key: 'errors', label: 'Occurrences', color: 'var(--series-8)', points: d.points }]}
              loading={detail.isFetching && detail.isPlaceholderData}
            />
          ) : (
            <Skeleton className="h-[180px]" />
          )}
        </div>
      </Card>

      {d && (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <Breakdown title="Platforms" by="platform" rows={d.breakdown.platform} />
            <Breakdown title="App versions" by="app_version" rows={d.breakdown.appVersion} />
            <Breakdown title="Operating systems" by="os" rows={d.breakdown.os} />
          </div>
          <h2 className="mb-3 text-base font-semibold tracking-tight">Recent occurrences</h2>
          <Card className="overflow-hidden">
            <ul>
              {d.samples.map((e) => (
                <Sample key={e.id} event={e} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </Page>
  )
}
