import type { SchemaMode } from '@serverless-analytics/core/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Sparkline } from '../components/chart'
import { Dialog } from '../components/dialog'
import { PlusIcon, SearchIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Button, EmptyState, Field, Input, Kbd, RadioCards, Skeleton } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatCompact, formatRelative } from '../lib/format'
import { useSearchParams } from '../lib/url'

export const SCHEMA_MODES: { value: SchemaMode; label: string; description: string }[] = [
  { value: 'permissive', label: 'Permissive', description: 'Accept any event. Define events later to document them.' },
  { value: 'strict', label: 'Strict', description: 'Reject events and properties that don’t match a definition.' },
]

function NewAppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [schemaMode, setSchemaMode] = useState<SchemaMode>('permissive')
  const create = useMutation({
    mutationFn: () => api.createApp({ name, schemaMode }),
    onSuccess: ({ app }) => {
      queryClient.invalidateQueries({ queryKey: ['apps'] })
      onClose()
      navigate(`/apps/${app.id}`)
    },
  })

  useEffect(() => {
    if (open) {
      setName('')
      setSchemaMode('permissive')
      create.reset()
    }
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New app"
      description="Each app gets its own write key, events and settings."
      onSubmit={() => create.mutate()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="app-name" error={create.error instanceof ApiError ? create.error.message : null}>
        <Input id="app-name" autoFocus required maxLength={64} placeholder="iOS app" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Schema mode">
        <RadioCards name="schema-mode" value={schemaMode} onChange={setSchemaMode} options={SCHEMA_MODES} />
      </Field>
    </Dialog>
  )
}

export function AppsPage() {
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps })
  const { params, set } = useSearchParams()
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const creating = params.get('new') === '1'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const list = (apps.data?.apps ?? []).filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Page title="Apps" description="Every app sends events with its own write key.">
      <div className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input
            ref={search}
            type="search"
            aria-label="Search apps"
            placeholder="Search apps…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-10 pl-9"
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:block">
            <Kbd>/</Kbd>
          </span>
        </div>
        <Button variant="primary" size="md" className="!h-9" icon={<PlusIcon />} onClick={() => set('new', '1')}>
          New app
        </Button>
      </div>

      {apps.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : list.length === 0 ? (
        query ? (
          <EmptyState title="No matching apps" description={`Nothing matches “${query}”.`} />
        ) : (
          <EmptyState
            title="Create your first app"
            description="An app is anything that sends events: a website, an Android or iOS app, a desktop client or a backend."
            action={
              <Button variant="primary" icon={<PlusIcon />} onClick={() => set('new', '1')}>
                New app
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((app) => (
            <li key={app.id}>
              <Link
                href={`/apps/${app.id}`}
                className="flex h-full flex-col gap-4 rounded-lg border border-border bg-bg p-5 transition-colors hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{app.name}</div>
                    <div className="truncate font-mono text-xs text-muted">{app.id}</div>
                  </div>
                  {app.schemaMode === 'strict' && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">Strict</span>
                  )}
                </div>
                <Sparkline points={app.sparkline} />
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>
                    <span className="font-medium text-fg tabular">{formatCompact(app.events24h)}</span> events in 24h
                  </span>
                  <span title={new Date(app.createdAt).toLocaleString()}>Created {formatRelative(app.createdAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewAppDialog open={creating} onClose={() => set('new', null)} />
    </Page>
  )
}
