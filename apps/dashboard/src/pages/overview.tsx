import type { GroupBy } from '@serverless-analytics/core/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { TimeSeriesChart } from '../components/chart'
import { AddFilter, FilterChips, RangeSelect, useRange } from '../components/filters'
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, MinusIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Quickstart } from '../components/quickstart'
import { Card, CopyButton, Segmented, Skeleton, cx } from '../components/ui'
import { api } from '../lib/api'
import { formatCompact, formatDecimal, formatNumber, formatPercent, formatValue, PREVIOUS_LABELS } from '../lib/format'
import { useFilters, useSearchParams } from '../lib/url'

function Delta({ current, previous, range }: { current: number; previous: number; range: string }) {
  const period = `vs ${PREVIOUS_LABELS[range]}`
  if (previous === 0) {
    return <span className="text-[13px] text-muted">{current > 0 ? `No data for ${PREVIOUS_LABELS[range]}` : period}</span>
  }
  const change = (current - previous) / previous
  const flat = Math.abs(change) < 0.005
  const up = change > 0
  return (
    <span className="flex items-center gap-1.5 text-[13px]">
      <span className={cx('flex items-center gap-0.5 font-medium', flat ? 'text-muted' : up ? 'text-success' : 'text-danger')}>
        {flat ? <MinusIcon size={14} /> : up ? <ArrowUpIcon size={14} /> : <ArrowDownIcon size={14} />}
        <span className="sr-only">{flat ? 'unchanged' : up ? 'up' : 'down'}</span>
        {formatPercent(Math.abs(change))}
      </span>
      <span className="text-muted">{period}</span>
    </span>
  )
}

function StatTile({ label, value, delta, loading }: { label: string; value: string; delta: React.ReactNode; loading: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 p-5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {loading ? <Skeleton className="h-8 w-24" /> : <span className="text-[28px] leading-8 font-semibold tracking-tight">{value}</span>}
      {loading ? <Skeleton className="h-5 w-40" /> : delta}
    </div>
  )
}

function TopPanel({ appId, title, groupBy, range }: { appId: string; title: string; groupBy: GroupBy; range: string }) {
  const { raw: f, add, filters } = useFilters()
  const top = useQuery({
    queryKey: ['top', appId, groupBy, range, f],
    queryFn: () => api.top(appId, { groupBy, range, f, limit: 8 }),
    placeholderData: keepPreviousData,
  })
  const rows = top.data?.rows ?? []
  const max = Math.max(1, ...rows.map((r) => r.events))
  const active = filters.find((x) => x.by === groupBy)

  return (
    <Card className="flex flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-muted">Events</span>
      </div>
      <div className={cx('flex flex-col md:min-h-64 gap-0.5 p-2 transition-opacity', top.isFetching && top.isPlaceholderData && 'opacity-50')}>
        {top.isPending ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)
        ) : rows.length === 0 ? (
          <p className="m-auto text-[13px] text-muted">No data for this period</p>
        ) : (
          rows.map((row) => {
            const label = formatValue(groupBy, row.value)
            const disabled = row.value === null || active?.value === row.value
            return (
              <button
                key={row.value ?? '__null'}
                type="button"
                disabled={disabled}
                onClick={() => row.value !== null && add(groupBy, row.value)}
                title={disabled ? label : `Filter by ${label}`}
                className="group relative flex h-8 items-center justify-between gap-3 rounded-md px-2 text-left text-[13px] enabled:hover:bg-hover disabled:cursor-default"
              >
                <span
                  className="absolute inset-y-0.5 left-0 rounded-[5px] bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]"
                  style={{ width: `${(row.events / max) * 100}%` }}
                  aria-hidden="true"
                />
                <span className={cx('relative truncate', row.value === null && 'text-muted italic')}>{label}</span>
                <span className="relative font-medium tabular">{formatCompact(row.events)}</span>
              </button>
            )
          })
        )}
      </div>
    </Card>
  )
}

function Onboarding({ appId }: { appId: string }) {
  const app = useQuery({ queryKey: ['app', appId], queryFn: () => api.app(appId) })
  if (!app.data) return null
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-6 p-6 lg:flex-row lg:gap-10">
        <div className="flex flex-col gap-3 lg:w-72 lg:shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-[var(--warning)] [animation:pulse-dot_1.6s_ease-in-out_infinite]" />
            Waiting for the first event…
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Send your first event</h2>
          <p className="text-sm text-muted">
            Any client that can make an HTTP request can send events: web, Android, iOS, desktop or server. This page updates as soon as one
            arrives.
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">Write key</span>
            <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-subtle pr-0.5 pl-3">
              <code className="truncate font-mono text-[12.5px]">{app.data.app.writeKey}</code>
              <CopyButton value={app.data.app.writeKey} label="Copy write key" />
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Quickstart writeKey={app.data.app.writeKey} />
        </div>
      </div>
    </Card>
  )
}

function ActiveUsersCard({ appId }: { appId: string }) {
  const { raw: f } = useFilters()
  const active = useQuery({
    queryKey: ['active-users', appId, f],
    queryFn: () => api.activeUsers(appId, { f }),
    placeholderData: keepPreviousData,
  })
  const a = active.data
  const items = [
    { label: 'Daily active', hint: 'Last 24 hours', value: a ? formatNumber(a.dau) : null },
    { label: 'Weekly active', hint: 'Last 7 days', value: a ? formatNumber(a.wau) : null },
    { label: 'Monthly active', hint: 'Last 30 days', value: a ? formatNumber(a.mau) : null },
    { label: 'Stickiness', hint: 'DAU ÷ MAU', value: a ? (a.mau ? formatPercent(a.dau / a.mau) : '—') : null },
  ]
  return (
    <Card className="mb-8 grid grid-cols-2 divide-border overflow-hidden sm:grid-cols-4 sm:divide-x">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 px-5 py-4">
          <span className="text-[13px] font-medium text-muted">{item.label}</span>
          {item.value === null ? <Skeleton className="h-7 w-16" /> : <span className="text-xl font-semibold tracking-tight">{item.value}</span>}
          <span className="text-xs text-faint">{item.hint}</span>
        </div>
      ))}
    </Card>
  )
}

const PANELS: { title: string; groupBy: GroupBy }[] = [
  { title: 'Events', groupBy: 'name' },
  { title: 'Platforms', groupBy: 'platform' },
  { title: 'Channels', groupBy: 'channel' },
  { title: 'Countries', groupBy: 'country' },
  { title: 'Regions', groupBy: 'region' },
  { title: 'Operating systems', groupBy: 'os' },
  { title: 'App versions', groupBy: 'app_version' },
  { title: 'Browsers', groupBy: 'browser' },
]

export function OverviewPage({ appId }: { appId: string }) {
  const { range } = useRange()
  const { raw: f } = useFilters()
  const { params, set } = useSearchParams()
  const metric = params.get('metric') === 'users' ? 'users' : 'events'

  const probe = useQuery({
    queryKey: ['events', appId, 'probe'],
    queryFn: () => api.events(appId, { limit: 1 }),
    refetchInterval: (q) => (q.state.data && q.state.data.events.length === 0 ? 4000 : false),
  })
  const overview = useQuery({
    queryKey: ['overview', appId, range, f],
    queryFn: () => api.overview(appId, { range, f }),
    placeholderData: keepPreviousData,
  })

  const data = overview.data
  const loading = overview.isPending
  const perUser = (e: number, u: number) => (u > 0 ? e / u : 0)

  if (probe.data?.events.length === 0) {
    return (
      <Page>
        <Onboarding appId={appId} />
      </Page>
    )
  }

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <RangeSelect />
        <AddFilter appId={appId} range={range} />
        <FilterChips />
      </div>

      <Card className="mb-8 overflow-hidden">
        <div className="grid divide-y divide-border border-b border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <StatTile
            label="Events"
            loading={loading}
            value={formatNumber(data?.totals.events ?? 0)}
            delta={data && <Delta current={data.totals.events} previous={data.previous.events} range={range} />}
          />
          <StatTile
            label="Unique users"
            loading={loading}
            value={formatNumber(data?.totals.users ?? 0)}
            delta={data && <Delta current={data.totals.users} previous={data.previous.users} range={range} />}
          />
          <StatTile
            label="Events per user"
            loading={loading}
            value={formatDecimal(perUser(data?.totals.events ?? 0, data?.totals.users ?? 0))}
            delta={
              data && (
                <Delta
                  current={perUser(data.totals.events, data.totals.users)}
                  previous={perUser(data.previous.events, data.previous.users)}
                  range={range}
                />
              )
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-sm font-medium">{metric === 'users' ? 'Unique users' : 'Events'} over time</h2>
          <Segmented
            label="Metric"
            value={metric}
            onChange={(m) => set('metric', m === 'events' ? null : m)}
            options={[
              { value: 'events', label: 'Events' },
              { value: 'users', label: 'Users' },
            ]}
          />
        </div>
        <div className="px-3 pt-2 pb-4">
          {data ? (
            <TimeSeriesChart
              label={`${metric === 'users' ? 'Unique users' : 'Events'} per ${data.range.interval}`}
              buckets={data.buckets}
              interval={data.range.interval}
              loading={overview.isFetching && overview.isPlaceholderData}
              partialLast={data.range.to > Date.now()}
              series={[{ key: metric, label: metric === 'users' ? 'Users' : 'Events', color: 'var(--series-1)', points: data[metric] }]}
            />
          ) : (
            <Skeleton className="h-[260px]" />
          )}
        </div>
      </Card>

      <ActiveUsersCard appId={appId} />

      <div className="grid gap-4 md:grid-cols-2">
        {PANELS.map((p) => (
          <TopPanel key={p.groupBy} appId={appId} title={p.title} groupBy={p.groupBy} range={range} />
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <Link href={`/apps/${appId}/explore${range !== '7d' ? `?range=${range}` : ''}`} className="flex items-center gap-1 text-sm text-muted hover:text-fg">
          Explore events in detail
          <ChevronRightIcon size={14} />
        </Link>
      </div>
    </Page>
  )
}
