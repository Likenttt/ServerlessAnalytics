import type { GroupBy, InsightsSeries } from '@serverless-analytics/core/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { TimeSeriesChart, type ChartSeries } from '../components/chart'
import { AddFilter, FilterChips, GroupByOptions, RangeSelect, useRange } from '../components/filters'
import { FilterIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Card, EmptyState, IconButton, Select, Skeleton, cx } from '../components/ui'
import { api } from '../lib/api'
import { formatMetric, formatPercent, formatValue, groupByLabel, metricLabel } from '../lib/format'
import { useFilters, useSearchParams } from '../lib/url'

/** Keeps a series' color tied to its key across refetches and filter changes. */
function useStableColors(scope: string) {
  const slots = useRef<{ scope: string; map: Map<string, number> }>({ scope, map: new Map() })
  if (slots.current.scope !== scope) slots.current = { scope, map: new Map() }
  return (key: string) => {
    const map = slots.current.map
    if (!map.has(key)) {
      const used = new Set(map.values())
      let slot = 0
      while (used.has(slot) && slot < 7) slot++
      map.set(key, slot)
    }
    return `var(--series-${map.get(key)! + 1})`
  }
}

const seriesKey = (s: InsightsSeries) => s.key ?? '__none'

export function ExplorePage({ appId }: { appId: string }) {
  const { range } = useRange()
  const { params, set } = useSearchParams()
  const { raw: f, add } = useFilters()
  const event = params.get('event') ?? ''
  const metric = params.get('metric') || 'events'
  const isCount = metric === 'events' || metric === 'users'
  const groupBy = (params.get('groupBy') ?? '') as GroupBy | ''
  const interval = params.get('interval') ?? ''
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const names = useQuery({ queryKey: ['definitions', appId], queryFn: () => api.definitions(appId) })
  const properties = useQuery({ queryKey: ['properties', appId, event], queryFn: () => api.properties(appId, event || null) })
  const insights = useQuery({
    queryKey: ['insights', appId, range, event, metric, groupBy, interval, f],
    queryFn: () => api.insights(appId, { range, event, metric, groupBy, interval, f }),
    placeholderData: keepPreviousData,
  })

  const eventNames = useMemo(() => {
    const d = names.data
    if (!d) return []
    return [...new Set([...d.definitions.map((x) => x.name), ...d.undefinedEvents.map((x) => x.name)])].sort()
  }, [names.data])

  const colorFor = useStableColors(`${groupBy}|${event}`)
  const data = insights.data
  const series: ChartSeries[] = (data?.series ?? []).map((s) => ({
    key: seriesKey(s),
    label: data?.groupBy ? formatValue(data.groupBy, s.key) : s.key ?? 'All events',
    color: colorFor(seriesKey(s)),
    points: s.points,
  }))
  const visible = series.filter((s) => !hidden.has(s.key))
  const sum = data?.series.reduce((a, s) => a + s.total, 0) ?? 0
  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const hourlyAllowed = range === '24h' || range === '7d'

  return (
    <Page>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Event" value={event} onChange={(e) => set('event', e.target.value || null)} className="min-w-44">
          <option value="">All events</option>
          {eventNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Select aria-label="Metric" value={metric} onChange={(e) => set('metric', e.target.value === 'events' ? null : e.target.value)}>
          <option value="events">Event count</option>
          <option value="users">Unique users</option>
          <option value="per_user">Events per user</option>
          {(properties.data?.keys.length ?? 0) > 0 && (
            <>
              <optgroup label="Sum of property">
                {properties.data!.keys.map((k) => (
                  <option key={`sum:${k}`} value={`sum:${k}`}>
                    Sum of {k}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Average of property">
                {properties.data!.keys.map((k) => (
                  <option key={`avg:${k}`} value={`avg:${k}`}>
                    Average {k}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </Select>
        <Select aria-label="Breakdown" value={groupBy} onChange={(e) => set('groupBy', e.target.value || null)}>
          <option value="">No breakdown</option>
          <GroupByOptions properties={properties.data?.keys ?? []} exclude={event ? ['name'] : []} />
        </Select>
        <RangeSelect />
        <AddFilter appId={appId} range={range} event={event} />
        {hourlyAllowed && range !== '24h' && (
          <Select aria-label="Interval" value={interval || 'day'} onChange={(e) => set('interval', e.target.value === 'day' ? null : e.target.value)}>
            <option value="day">Daily</option>
            <option value="hour">Hourly</option>
          </Select>
        )}
      </div>
      <div className="mb-6 min-h-0">
        <FilterChips />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4">
          <h1 className="mr-auto text-sm font-medium">
            {metricLabel(metric)}
            {event ? ` · ${event}` : ''}
            {groupBy ? ` by ${groupByLabel(groupBy)}` : ''}
          </h1>
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
              {series.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-pressed={!hidden.has(s.key)}
                    onClick={() => toggle(s.key)}
                    className={cx('flex items-center gap-1.5 rounded text-[13px]', hidden.has(s.key) ? 'text-faint line-through' : 'text-muted hover:text-fg')}
                  >
                    <span className="h-0.5 w-3 rounded-full" style={{ background: hidden.has(s.key) ? 'var(--border-strong)' : s.color }} />
                    <span className="max-w-40 truncate">{s.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-3 pt-4 pb-4">
          {!data ? (
            <Skeleton className="h-[300px]" />
          ) : data.series.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-[13px] text-muted">No events match this query</div>
          ) : (
            <TimeSeriesChart
              label={`${metric} per ${data.range.interval}`}
              height={300}
              buckets={data.buckets}
              interval={data.range.interval}
              series={visible}
              area={visible.length === 1}
              integer={isCount}
              format={(n) => formatMetric(n, metric)}
              loading={insights.isFetching && insights.isPlaceholderData}
              partialLast={data.range.to > Date.now()}
            />
          )}
        </div>

        {data && data.series.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="h-10 px-5 font-medium">{groupBy ? groupByLabel(groupBy) : 'Series'}</th>
                  <th className="h-10 px-5 text-right font-medium">{metricLabel(metric)}</th>
                  {metric === 'events' && <th className="h-10 px-5 text-right font-medium">Share</th>}
                  <th className="h-10 w-12 px-3" />
                </tr>
              </thead>
              <tbody>
                {data.series.map((s, i) => {
                  const chart = series[i]!
                  return (
                    <tr key={chart.key} className="border-t border-border">
                      <td className="h-11 px-5">
                        <span className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: chart.color }} />
                          <span className={cx('truncate', s.key === null && 'text-muted italic')}>{chart.label}</span>
                        </span>
                      </td>
                      <td className="px-5 text-right font-medium tabular">{formatMetric(s.total, metric)}</td>
                      {metric === 'events' && <td className="px-5 text-right text-muted tabular">{sum ? formatPercent(s.total / sum) : '—'}</td>}
                      <td className="px-3 text-right">
                        {data.groupBy && s.key !== null && (
                          <IconButton label={`Filter by ${chart.label}`} onClick={() => add(data.groupBy!, s.key!)}>
                            <FilterIcon />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {names.data && eventNames.length === 0 && (
        <div className="mt-6">
          <EmptyState title="No events yet" description="Send an event and it will show up here within seconds." />
        </div>
      )}
    </Page>
  )
}
