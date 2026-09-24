import { DIMENSIONS } from '@serverless-analytics/core/types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { DIMENSION_LABELS, formatValue, groupByLabel, RANGE_LABELS } from '../lib/format'
import { useFilters, useSearchParams } from '../lib/url'
import { Dialog } from './dialog'
import { FilterIcon, XIcon } from './icons'
import { Button, Field, Input, Select } from './ui'

export function useRange() {
  const { params, set } = useSearchParams()
  const range = params.get('range') ?? '7d'
  return { range: RANGE_LABELS[range] ? range : '7d', setRange: (r: string) => set('range', r === '7d' ? null : r) }
}

export function RangeSelect() {
  const { range, setRange } = useRange()
  return (
    <Select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value)}>
      {Object.entries(RANGE_LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </Select>
  )
}

export function FilterChips() {
  const { filters, remove } = useFilters()
  if (filters.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {filters.map((f) => (
        <li key={f.raw} className="flex h-8 items-center gap-1 rounded-md border border-border-strong bg-subtle pr-1 pl-2.5 text-[13px]">
          <span className="text-muted">{groupByLabel(f.by)}</span>
          <span className="text-muted">is</span>
          <span className="max-w-48 truncate font-medium">{formatValue(f.by, f.value)}</span>
          <button
            type="button"
            onClick={() => remove(f.raw)}
            aria-label={`Remove filter ${groupByLabel(f.by)} is ${f.value}`}
            className="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
          >
            <XIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Dimensions plus the app's known property keys, for breakdown / filter pickers. */
export function GroupByOptions({ properties, exclude = [] }: { properties: string[]; exclude?: string[] }) {
  return (
    <>
      <optgroup label="Dimensions">
        {DIMENSIONS.filter((d) => !exclude.includes(d)).map((d) => (
          <option key={d} value={d}>
            {DIMENSION_LABELS[d] ?? d}
          </option>
        ))}
      </optgroup>
      {properties.length > 0 && (
        <optgroup label="Properties">
          {properties.map((k) => (
            <option key={k} value={`prop:${k}`}>
              {k}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}

/** "Add filter": pick a dimension or property, then one of its values seen in the range. */
export function AddFilter({ appId, range, event }: { appId: string; range: string; event?: string | null }) {
  const { add, raw } = useFilters()
  const [open, setOpen] = useState(false)
  const [by, setBy] = useState<string>('platform')
  const [value, setValue] = useState('')
  const properties = useQuery({ queryKey: ['properties', appId, event ?? ''], queryFn: () => api.properties(appId, event || null), enabled: open })
  const values = useQuery({
    queryKey: ['top', appId, by, range, raw, 'filter-values'],
    queryFn: () => api.top(appId, { groupBy: by, range, f: raw, limit: 50 }),
    enabled: open,
  })
  const options = (values.data?.rows ?? []).filter((r) => r.value !== null)

  return (
    <>
      <Button icon={<FilterIcon />} onClick={() => setOpen(true)}>
        Filter
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add filter"
        description="Only count events that match."
        onSubmit={() => {
          if (!value) return
          add(by, value)
          setOpen(false)
          setValue('')
        }}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!value}>
              Apply
            </Button>
          </>
        }
      >
        <Field label="Field" htmlFor="filter-by">
          <Select
            id="filter-by"
            size="md"
            value={by}
            onChange={(e) => {
              setBy(e.target.value)
              setValue('')
            }}
          >
            <GroupByOptions properties={properties.data?.keys ?? []} />
          </Select>
        </Field>
        <Field label="Value" htmlFor="filter-value" hint={values.isFetching ? 'Loading values…' : `${options.length} values seen in this period`}>
          <Input id="filter-value" list="filter-values" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Type or pick a value" />
          <datalist id="filter-values">
            {options.map((r) => (
              <option key={r.value} value={r.value!}>
                {formatValue(by, r.value)} · {r.events}
              </option>
            ))}
          </datalist>
        </Field>
      </Dialog>
    </>
  )
}
