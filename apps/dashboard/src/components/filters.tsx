import { formatValue, groupByLabel, RANGE_LABELS } from '../lib/format'
import { useFilters, useSearchParams } from '../lib/url'
import { XIcon } from './icons'
import { Select } from './ui'

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
