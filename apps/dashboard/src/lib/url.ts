import { useCallback, useMemo } from 'react'
import { useLocation, useSearch } from 'wouter'

/** Filters, ranges and tabs live in the URL so views are shareable and survive reloads. */
export function useSearchParams() {
  const search = useSearch()
  const [location, navigate] = useLocation()
  const params = useMemo(() => new URLSearchParams(search), [search])

  const update = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(search)
      mutate(next)
      const s = next.toString()
      navigate(`${location}${s ? `?${s}` : ''}`, { replace: true })
    },
    [search, location, navigate],
  )

  const set = useCallback(
    (key: string, value: string | null) =>
      update((p) => {
        if (value === null || value === '') p.delete(key)
        else p.set(key, value)
      }),
    [update],
  )

  return { params, set, update }
}

export interface FilterChip {
  by: string
  value: string
  raw: string
}

export function useFilters() {
  const { params, update } = useSearchParams()
  const raw = params.getAll('f')
  const filters: FilterChip[] = raw
    .map((f) => {
      const i = f.indexOf('=')
      return i > 0 ? { by: f.slice(0, i), value: f.slice(i + 1), raw: f } : null
    })
    .filter((f): f is FilterChip => f !== null)

  const add = (by: string, value: string) =>
    update((p) => {
      const entry = `${by}=${value}`
      const rest = p.getAll('f').filter((f) => !f.startsWith(`${by}=`))
      p.delete('f')
      for (const f of [...rest, entry]) p.append('f', f)
    })
  const remove = (rawValue: string) =>
    update((p) => {
      const rest = p.getAll('f').filter((f) => f !== rawValue)
      p.delete('f')
      for (const f of rest) p.append('f', f)
    })
  return { filters, raw, add, remove }
}
