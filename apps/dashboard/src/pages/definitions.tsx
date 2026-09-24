import type { DefinitionsResponse, PropertyDefinition, PropertyType } from '@serverless-analytics/core/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { Dialog } from '../components/dialog'
import { PlusIcon, TrashIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Note, Select, Skeleton, Textarea, cx } from '../components/ui'
import { useToast } from '../components/toast'
import { api, ApiError } from '../lib/api'
import { formatCompact, formatDateTime, formatRelative } from '../lib/format'

type Definition = DefinitionsResponse['definitions'][number]

interface Draft {
  name: string
  description: string
  status: 'active' | 'archived'
  properties: (PropertyDefinition & { uid: number })[]
}

let uid = 0
const withUid = (p: PropertyDefinition) => ({ ...p, uid: ++uid })
const emptyProperty = () => withUid({ name: '', type: 'string', required: false, description: '' })

const TYPES: { value: PropertyType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'any', label: 'Any' },
]

function inferType(values: unknown[]): PropertyType {
  const types = new Set(values.filter((v) => v !== null && v !== undefined).map((v) => typeof v))
  if (types.size !== 1) return 'any'
  const [t] = types
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'any'
}

function DefinitionDialog({
  appId,
  open,
  onClose,
  initial,
  editing,
}: {
  appId: string
  open: boolean
  onClose: () => void
  initial: Draft
  editing: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(initial)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(initial)
      setConfirmDelete(false)
    }
  }, [open, initial])

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['definitions', appId] })
    toast(message)
    onClose()
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        description: draft.description,
        status: draft.status,
        properties: draft.properties.filter((p) => p.name.trim()).map(({ uid: _, ...p }) => ({ ...p, name: p.name.trim() })),
      }
      return editing ? api.updateDefinition(appId, draft.name, body) : api.createDefinition(appId, { ...body, name: draft.name.trim() })
    },
    onSuccess: () => done(editing ? `Saved “${draft.name}”` : `Defined “${draft.name}”`),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteDefinition(appId, draft.name),
    onSuccess: () => done(`Deleted “${draft.name}”`),
  })

  const updateProp = (id: number, patch: Partial<PropertyDefinition>) =>
    setDraft((d) => ({ ...d, properties: d.properties.map((p) => (p.uid === id ? { ...p, ...patch } : p)) }))

  const error = save.error ?? remove.error

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={editing ? draft.name : 'Define event'}
      description={editing ? 'Update the description, status and expected properties.' : 'Document an event and the properties it carries.'}
      onSubmit={() => save.mutate()}
      footer={
        <>
          {editing && (
            <Button
              variant={confirmDelete ? 'danger' : 'tertiary'}
              className={cx('mr-auto', !confirmDelete && '!text-danger hover:!bg-danger-bg')}
              icon={<TrashIcon />}
              loading={remove.isPending}
              onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {editing ? 'Save' : 'Define event'}
          </Button>
        </>
      }
    >
      {!editing && (
        <Field label="Event name" htmlFor="def-name" hint="Letters, numbers, spaces and _ . : - $ — for example checkout_completed.">
          <Input
            id="def-name"
            mono
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
      )}
      <Field label="Description" htmlFor="def-description">
        <Textarea
          id="def-description"
          rows={2}
          maxLength={1000}
          placeholder="When is this event sent?"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </Field>
      <Field label="Status" htmlFor="def-status" hint="Archived events are rejected when the app is in strict mode.">
        <Select id="def-status" size="md" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium text-muted">Properties</legend>
        {draft.properties.length > 0 && (
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_76px_minmax(0,1fr)_32px] gap-2 text-xs text-muted sm:grid">
            <span>Name</span>
            <span>Type</span>
            <span>Required</span>
            <span>Description</span>
          </div>
        )}
        {draft.properties.map((p) => (
          <div key={p.uid} className="grid grid-cols-[minmax(0,1fr)_110px_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_110px_76px_minmax(0,1fr)_32px]">
            <Input
              mono
              aria-label="Property name"
              placeholder="plan"
              spellCheck={false}
              autoComplete="off"
              maxLength={64}
              value={p.name}
              onChange={(e) => updateProp(p.uid, { name: e.target.value })}
            />
            <Select aria-label="Property type" size="md" value={p.type} onChange={(e) => updateProp(p.uid, { type: e.target.value as PropertyType })}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <label className="order-last col-span-2 flex items-center gap-2 text-[13px] sm:order-none sm:col-span-1 sm:justify-center">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) => updateProp(p.uid, { required: e.target.checked })}
                className="h-4 w-4 accent-[var(--fg)]"
              />
              <span className="sm:sr-only">Required</span>
            </label>
            <Input
              aria-label="Property description"
              placeholder="Optional"
              className="order-last col-span-3 sm:order-none sm:col-span-1"
              maxLength={500}
              value={p.description}
              onChange={(e) => updateProp(p.uid, { description: e.target.value })}
            />
            <IconButton
              label={`Remove property ${p.name}`}
              onClick={() => setDraft((d) => ({ ...d, properties: d.properties.filter((x) => x.uid !== p.uid) }))}
            >
              <TrashIcon />
            </IconButton>
          </div>
        ))}
        <div>
          <Button variant="tertiary" className="-ml-2" icon={<PlusIcon />} onClick={() => setDraft((d) => ({ ...d, properties: [...d.properties, emptyProperty()] }))}>
            Add property
          </Button>
        </div>
      </fieldset>

      {error && <Note tone="danger">{error instanceof ApiError ? error.message : 'Something went wrong'}</Note>}
    </Dialog>
  )
}

const blank = (): Draft => ({ name: '', description: '', status: 'active', properties: [] })

export function DefinitionsPage({ appId }: { appId: string }) {
  const defs = useQuery({ queryKey: ['definitions', appId], queryFn: () => api.definitions(appId) })
  const app = useQuery({ queryKey: ['app', appId], queryFn: () => api.app(appId) })
  const [dialog, setDialog] = useState<{ draft: Draft; editing: boolean } | null>(null)
  const [preparing, setPreparing] = useState<string | null>(null)

  const edit = (d: Definition) =>
    setDialog({ editing: true, draft: { name: d.name, description: d.description, status: d.status, properties: d.properties.map(withUid) } })

  // Pre-fill properties (with inferred types) from recent occurrences of the event.
  const defineSeen = async (name: string) => {
    setPreparing(name)
    try {
      const { events } = await api.events(appId, { name, limit: 50 })
      const keys = [...new Set(events.flatMap((e) => Object.keys(e.properties)))]
      const properties = keys.map((key) =>
        withUid({ name: key, type: inferType(events.map((e) => e.properties[key])), required: events.every((e) => key in e.properties), description: '' }),
      )
      setDialog({ editing: false, draft: { name, description: '', status: 'active', properties } })
    } finally {
      setPreparing(null)
    }
  }

  const strict = app.data?.app.schemaMode === 'strict'

  return (
    <Page
      title="Events"
      description="Your tracking plan: the events this app sends and the properties they carry."
      actions={
        <Button variant="primary" size="md" className="!h-9" icon={<PlusIcon />} onClick={() => setDialog({ editing: false, draft: blank() })}>
          Define event
        </Button>
      }
    >
      {app.data && (
        <div className="mb-6">
          <Note tone={strict ? 'warning' : 'info'}>
            {strict ? (
              <>
                <strong className="font-medium">Strict mode.</strong> Events that aren’t defined here, are archived, or have missing or mistyped
                required properties are rejected at ingestion.{' '}
              </>
            ) : (
              <>
                <strong className="font-medium">Permissive mode.</strong> Every event is accepted; definitions document your tracking plan.{' '}
              </>
            )}
            <Link href={`/apps/${appId}/settings`} className="underline underline-offset-2">
              Change in settings
            </Link>
          </Note>
        </div>
      )}

      {defs.isPending ? (
        <Skeleton className="h-48" />
      ) : defs.data!.definitions.length === 0 ? (
        <EmptyState
          title="No events defined"
          description="Define an event to document when it fires and which properties it carries. In strict mode, only defined events are accepted."
          action={
            <Button icon={<PlusIcon />} onClick={() => setDialog({ editing: false, draft: blank() })}>
              Define event
            </Button>
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-subtle text-left text-xs text-muted">
                <th className="h-10 px-4 font-medium">Name</th>
                <th className="h-10 px-4 font-medium">Properties</th>
                <th className="h-10 px-4 font-medium">Status</th>
                <th className="h-10 px-4 text-right font-medium">Last 30 days</th>
                <th className="h-10 px-4 text-right font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {defs.data!.definitions.map((d) => (
                <tr key={d.name} className="border-b border-border last:border-b-0 hover:bg-subtle">
                  <td className="max-w-80 px-4 py-2.5">
                    <button type="button" onClick={() => edit(d)} className="block max-w-full text-left">
                      <span className="block truncate font-mono text-[12.5px] font-medium hover:underline">{d.name}</span>
                      {d.description && <span className="block truncate text-muted">{d.description}</span>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {d.properties.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        d.properties.slice(0, 4).map((p) => (
                          <span key={p.name} className="rounded border border-border px-1.5 py-px font-mono text-[11.5px]" title={`${p.type}${p.required ? ', required' : ''}`}>
                            {p.name}
                            {p.required && <span className="text-danger">*</span>}
                          </span>
                        ))
                      )}
                      {d.properties.length > 4 && <span className="text-xs text-muted">+{d.properties.length - 4}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={d.status === 'active' ? 'green' : 'gray'}>{d.status === 'active' ? 'Active' : 'Archived'}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular">{formatCompact(d.events30d)}</td>
                  <td className="px-4 py-2.5 text-right text-muted" title={d.lastSeen ? formatDateTime(d.lastSeen) : undefined}>
                    {d.lastSeen ? formatRelative(d.lastSeen) : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {defs.data && defs.data.undefinedEvents.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">Undefined events</h2>
            <p className="text-[13px] text-muted">Received in the last 30 days without a definition.</p>
          </div>
          <Card className="overflow-hidden">
            <ul>
              {defs.data.undefinedEvents.map((e) => (
                <li key={e.name} className="flex items-center gap-4 border-b border-border px-4 py-2.5 text-[13px] last:border-b-0">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{e.name}</span>
                  <span className="hidden text-muted sm:inline" title={formatDateTime(e.lastSeen)}>
                    {formatRelative(e.lastSeen)}
                  </span>
                  <span className="w-16 text-right font-medium tabular">{formatCompact(e.events30d)}</span>
                  <Button loading={preparing === e.name} onClick={() => defineSeen(e.name)}>
                    Define
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <DefinitionDialog
        appId={appId}
        open={dialog !== null}
        onClose={() => setDialog(null)}
        initial={dialog?.draft ?? blank()}
        editing={dialog?.editing ?? false}
      />
    </Page>
  )
}
