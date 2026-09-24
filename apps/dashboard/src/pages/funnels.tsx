import type { FunnelStep } from '@serverless-analytics/core/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { AddFilter, FilterChips, GroupByOptions, RangeSelect, useRange } from '../components/filters'
import { PlusIcon, XIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Button, Card, EmptyState, IconButton, Note, Select, Skeleton, cx } from '../components/ui'
import { api } from '../lib/api'
import { formatDuration, formatNumber, formatPercent, formatValue, groupByLabel } from '../lib/format'
import { useFilters, useSearchParams } from '../lib/url'

const WINDOWS = [
  { hours: 1, label: 'within 1 hour' },
  { hours: 24, label: 'within 1 day' },
  { hours: 168, label: 'within 7 days' },
  { hours: 720, label: 'within 30 days' },
]

function StepBars({ steps }: { steps: FunnelStep[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} className="grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-center sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hover text-[11px] font-medium text-muted">{i + 1}</span>
            <span className="truncate font-mono text-[12.5px] font-medium">{s.name}</span>
          </div>
          <div className="relative h-8 overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--series-1)_12%,transparent)]" aria-hidden="true">
            <div className="h-full rounded-md bg-[var(--series-1)] transition-[width]" style={{ width: `${Math.max(s.conversion * 100, s.users ? 0.5 : 0)}%` }} />
          </div>
          <div className="flex items-baseline gap-3 text-[13px] sm:w-72 sm:justify-end">
            <span className="font-semibold tabular">{formatNumber(s.users)}</span>
            <span className="tabular">{formatPercent(s.conversion)}</span>
            {i > 0 && (
              <span className="text-muted">
                {formatPercent(s.stepConversion)} of prev{s.medianTimeMs !== null ? ` · ~${formatDuration(s.medianTimeMs)}` : ''}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function FunnelsPage({ appId }: { appId: string }) {
  const { range } = useRange()
  const { params, update, set } = useSearchParams()
  const { raw: f } = useFilters()
  const steps = params.getAll('step')
  const windowHours = Number(params.get('window') ?? 168)
  const groupBy = params.get('groupBy') ?? ''

  const definitions = useQuery({ queryKey: ['definitions', appId], queryFn: () => api.definitions(appId) })
  const properties = useQuery({ queryKey: ['properties', appId, steps[0] ?? ''], queryFn: () => api.properties(appId, steps[0] ?? null) })
  const names = useMemo(() => {
    const d = definitions.data
    return d ? [...new Set([...d.definitions.map((x) => x.name), ...d.undefinedEvents.map((x) => x.name)])].sort() : []
  }, [definitions.data])

  const ready = steps.length >= 2 && steps.every(Boolean)
  const funnel = useQuery({
    queryKey: ['funnel', appId, range, steps, windowHours, groupBy, f],
    queryFn: () => api.funnel(appId, { range, step: steps, window: windowHours, groupBy, f }),
    enabled: ready,
    placeholderData: keepPreviousData,
  })

  const setSteps = (next: string[]) =>
    update((p) => {
      p.delete('step')
      for (const s of next) p.append('step', s)
    })

  const editable = steps.length ? steps : ['', '']
  const data = ready ? funnel.data : undefined
  const last = data?.steps[data.steps.length - 1]

  return (
    <Page title="Funnels" description="How many users go through a sequence of events, in order, within a time window.">
      <Card className="mb-6 flex flex-col gap-3 p-5">
        <span className="text-[13px] font-medium text-muted">Steps</span>
        <ol className="flex flex-col gap-2">
          {editable.map((step, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-medium text-muted">{i + 1}</span>
              <Select
                aria-label={`Step ${i + 1}`}
                size="md"
                className="min-w-0 flex-1 sm:max-w-sm"
                value={step}
                onChange={(e) => setSteps(editable.map((s, j) => (j === i ? e.target.value : s)))}
              >
                <option value="">Choose an event…</option>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              {editable.length > 2 && (
                <IconButton label={`Remove step ${i + 1}`} onClick={() => setSteps(editable.filter((_, j) => j !== i))}>
                  <XIcon />
                </IconButton>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="tertiary" icon={<PlusIcon />} disabled={editable.length >= 8} onClick={() => setSteps([...editable, ''])}>
            Add step
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select aria-label="Conversion window" value={String(windowHours)} onChange={(e) => set('window', e.target.value === '168' ? null : e.target.value)}>
              {WINDOWS.map((w) => (
                <option key={w.hours} value={w.hours}>
                  Converted {w.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Breakdown" value={groupBy} onChange={(e) => set('groupBy', e.target.value || null)}>
              <option value="">No breakdown</option>
              <GroupByOptions properties={properties.data?.keys ?? []} exclude={['name']} />
            </Select>
            <RangeSelect />
            <AddFilter appId={appId} range={range} />
          </div>
        </div>
        <FilterChips />
      </Card>

      {!ready ? (
        <EmptyState title="Pick at least two steps" description="For example app_open → signup → purchase to see where users drop off." />
      ) : !data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className={cx('flex flex-col gap-6 transition-opacity', funnel.isFetching && funnel.isPlaceholderData && 'opacity-50')}>
          {data.truncated && <Note tone="warning">Too many users to scan in full; results are based on a sample. Narrow the range or add filters.</Note>}
          <Card className="p-5">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">Overall conversion</h2>
              <span className="text-2xl font-semibold tracking-tight">{last ? formatPercent(last.conversion) : '—'}</span>
            </div>
            <StepBars steps={data.steps} />
          </Card>

          {data.groups.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-subtle text-left text-xs text-muted">
                    <th className="h-10 px-4 font-medium">{groupByLabel(groupBy)}</th>
                    {data.steps.map((s, i) => (
                      <th key={i} className="h-10 px-4 text-right font-medium">
                        <span className="font-mono">{s.name}</span>
                      </th>
                    ))}
                    <th className="h-10 px-4 text-right font-medium">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.key ?? '__none'} className="border-b border-border last:border-b-0">
                      <td className={cx('px-4 py-2.5', g.key === null && 'text-muted italic')}>{formatValue(groupBy, g.key)}</td>
                      {g.steps.map((s, i) => (
                        <td key={i} className="px-4 text-right tabular">
                          {formatNumber(s.users)}
                        </td>
                      ))}
                      <td className="px-4 text-right font-medium tabular">{formatPercent(g.steps[g.steps.length - 1]?.conversion ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </Page>
  )
}
