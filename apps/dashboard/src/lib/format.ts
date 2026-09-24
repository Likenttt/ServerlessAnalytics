import type { Interval } from '@serverless-analytics/core/types'

const integer = new Intl.NumberFormat()
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export const formatNumber = (n: number) => integer.format(n)
export const formatCompact = (n: number) => (Math.abs(n) < 10_000 ? integer.format(n) : compact.format(n))
export const formatPercent = (n: number) => percent.format(n)
export const formatDecimal = (n: number) => decimal.format(n)

const hour = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dayHour = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export const formatTick = (ts: number, interval: Interval) => (interval === 'hour' ? hour.format(ts) : day.format(ts))
export const formatBucket = (ts: number, interval: Interval) =>
  interval === 'hour' ? dayHour.format(ts) : new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(ts)
export const formatDateTime = (ts: number) => full.format(ts)
export const formatDate = (ts: number) => dateOnly.format(ts)

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

export function formatRelative(ts: number, now = Date.now()): string {
  const seconds = Math.round((ts - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 5) return 'just now'
  if (abs < 60) return relative.format(seconds, 'second')
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day')
  return dateOnly.format(ts)
}

export const RANGE_LABELS: Record<string, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}

export const PREVIOUS_LABELS: Record<string, string> = {
  '24h': 'previous 24 hours',
  '7d': 'previous 7 days',
  '30d': 'previous 30 days',
  '90d': 'previous 90 days',
}

export const DIMENSION_LABELS: Record<string, string> = {
  name: 'Event',
  platform: 'Platform',
  channel: 'Channel',
  region: 'Region',
  os: 'OS',
  os_version: 'OS version',
  browser: 'Browser',
  app_version: 'App version',
  device: 'Device',
  country: 'Country',
  locale: 'Locale',
}

export const groupByLabel = (g: string) => (g.startsWith('prop:') ? g.slice(5) : (DIMENSION_LABELS[g] ?? g))

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' })
  } catch {
    return null
  }
})()

const PLATFORMS: Record<string, string> = {
  ios: 'iOS',
  ipados: 'iPadOS',
  android: 'Android',
  web: 'Web',
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  server: 'Server',
}

export function formatValue(groupBy: string, value: string | null): string {
  if (value === null) return '(none)'
  if (groupBy === 'platform') return PLATFORMS[value] ?? value
  if (groupBy === 'country') {
    try {
      return regionNames?.of(value) ?? value
    } catch {
      return value
    }
  }
  return value
}
