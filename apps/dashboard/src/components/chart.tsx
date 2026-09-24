import type { Interval } from '@serverless-analytics/core/types'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatBucket, formatCompact, formatNumber, formatTick } from '../lib/format'
import { cx } from './ui'

export interface ChartSeries {
  key: string
  label: string
  /** CSS color, e.g. var(--series-1). */
  color: string
  points: number[]
}

export const seriesColor = (index: number) => `var(--series-${(index % 8) + 1})`

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Round tick steps (1, 2, 5 × 10^n) for integer counts. */
function ticksFor(max: number, integer: boolean, target = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  const nice = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
  const step = integer ? Math.max(1, nice) : nice
  const ticks: number[] = []
  for (let i = 0; i * step < max + step; i++) ticks.push(Number((i * step).toPrecision(12)))
  return ticks
}

/**
 * Line (or single-series area) chart over time buckets. One axis, hairline
 * grid, 2px lines, a crosshair that snaps to the nearest bucket and a single
 * tooltip listing every series. Keyboard: focus, then ←/→.
 */
export function TimeSeriesChart({
  buckets,
  series,
  interval,
  height = 260,
  area = series.length === 1,
  loading = false,
  partialLast = false,
  integer = true,
  format = formatNumber,
  label,
}: {
  buckets: number[]
  series: ChartSeries[]
  interval: Interval
  height?: number
  area?: boolean
  loading?: boolean
  /** The last bucket is still in progress: draw its segment dashed. */
  partialLast?: boolean
  /** Counts: integer axis ticks. Set false for sums, averages and ratios. */
  integer?: boolean
  format?: (value: number) => string
  label: string
}) {
  const [containerRef, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const n = buckets.length

  const max = Math.max(0, ...series.flatMap((s) => s.points))
  const ticks = useMemo(() => ticksFor(max, integer), [max, integer])
  const yMax = ticks[ticks.length - 1] ?? 1
  const tickLabels = ticks.map((t) => (integer || t >= 1000 ? formatCompact(t) : String(t)))
  const margin = { top: 12, right: 16, bottom: 28, left: Math.max(...tickLabels.map((t) => t.length)) * 7 + 16 }
  const plotW = Math.max(0, width - margin.left - margin.right)
  const plotH = height - margin.top - margin.bottom

  const x = (i: number) => margin.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))
  const y = (v: number) => margin.top + plotH - (v / yMax) * plotH

  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 84))))
  const xTicks = buckets.map((b, i) => ({ b, i })).filter(({ i }) => (n - 1 - i) % xTickEvery === 0)

  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1))
    setActive(Math.min(n - 1, Math.max(0, i)))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setActive((a) => {
        const current = a ?? n - 1
        return Math.min(n - 1, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    } else if (e.key === 'Escape') setActive(null)
  }

  const tooltipLeft = active === null ? 0 : x(active)
  const flip = tooltipLeft > width - 220

  return (
    <div ref={containerRef} className={cx('relative w-full transition-opacity', loading && 'opacity-50')} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          className="block overflow-visible rounded-md"
        >
          {ticks.map((t, i) => (
            <g key={t}>
              <line x1={margin.left} x2={margin.left + plotW} y1={y(t)} y2={y(t)} stroke={i === 0 ? 'var(--axis)' : 'var(--grid)'} />
              <text x={margin.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tabular">
                {tickLabels[i]}
              </text>
            </g>
          ))}
          {xTicks.map(({ b, i }) => (
            <text key={b} x={x(i)} y={height - 8} textAnchor="middle" className="fill-faint text-[11px] tabular">
              {formatTick(b, interval)}
            </text>
          ))}

          {series.map((s) => {
            const pt = (i: number) => `${x(i).toFixed(1)},${y(s.points[i] ?? 0).toFixed(1)}`
            const line = s.points.map((_, i) => `${i === 0 ? 'M' : 'L'}${pt(i)}`).join('')
            const dashed = partialLast && n > 2
            const solid = dashed ? s.points.slice(0, -1).map((_, i) => `${i === 0 ? 'M' : 'L'}${pt(i)}`).join('') : line
            return (
              <g key={s.key}>
                {area && n > 1 && (
                  <path
                    d={`${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`}
                    fill={s.color}
                    fillOpacity={0.1}
                  />
                )}
                <path d={solid} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {dashed && (
                  <path d={`M${pt(n - 2)}L${pt(n - 1)}`} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
                )}
              </g>
            )
          })}

          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={margin.top} y2={margin.top + plotH} stroke="var(--border-strong)" />
              {series.map((s) => (
                <circle key={s.key} cx={x(active)} cy={y(s.points[active] ?? 0)} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />
              ))}
            </g>
          )}

          <rect
            x={margin.left}
            y={margin.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}

      {active !== null && buckets[active] !== undefined && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] shadow-[var(--shadow-popover)]"
          style={{ top: margin.top, left: flip ? undefined : tooltipLeft + 12, right: flip ? width - tooltipLeft + 12 : undefined }}
        >
          <div className="mb-1.5 text-xs text-muted">{formatBucket(buckets[active]!, interval)}</div>
          <div className="flex flex-col gap-1">
            {[...series]
              .sort((a, b) => (b.points[active] ?? 0) - (a.points[active] ?? 0))
              .map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold tabular">{format(s.points[active] ?? 0)}</span>
                  <span className="max-w-48 truncate text-muted">{s.label}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** A 7-point trend line for cards; muted, with the latest point emphasized. */
export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const h = 32
  const w = Math.max(0, width - 6)
  const max = Math.max(1, ...points)
  const step = points.length > 1 ? w / (points.length - 1) : 0
  const coords = points.map((v, i) => [3 + i * step, h - 3 - (v / max) * (h - 6)] as const)
  const d = coords.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const last = coords[coords.length - 1]
  return (
    <div ref={ref} className={cx('h-8 w-full', className)} aria-hidden="true">
      {width > 0 && (
        <svg width={width} height={h} className="block overflow-visible">
          <path d={`${d}L${3 + w},${h}L3,${h}Z`} fill="var(--fg)" fillOpacity={0.05} />
          <path d={d} fill="none" stroke="var(--fg-subtle)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {last && <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--fg)" />}
        </svg>
      )}
    </div>
  )
}
