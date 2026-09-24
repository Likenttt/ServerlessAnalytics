import type { App, SamplingConfig, SchemaMode } from '@serverless-analytics/core/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { Dialog } from '../components/dialog'
import { EyeIcon, EyeOffIcon, PlusIcon, RefreshIcon, TrashIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Quickstart } from '../components/quickstart'
import { Button, CopyButton, Field, IconButton, Input, Note, RadioCards, SettingsCard, Skeleton } from '../components/ui'
import { useToast } from '../components/toast'
import { api, ApiError } from '../lib/api'
import { formatDate } from '../lib/format'
import { SCHEMA_MODES } from './apps'

function useUpdateApp(appId: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (patch: Partial<Pick<App, 'name' | 'schemaMode' | 'retentionDays' | 'sampling'>>) => api.updateApp(appId, patch),
    onSuccess: ({ app }) => {
      queryClient.setQueryData(['app', appId], { app })
      queryClient.invalidateQueries({ queryKey: ['apps'] })
      toast('Settings saved')
    },
  })
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong' : null)

function NameCard({ app }: { app: App }) {
  const [name, setName] = useState(app.name)
  const update = useUpdateApp(app.id)
  useEffect(() => setName(app.name), [app.name])
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate({ name })
      }}
    >
      <SettingsCard
        title="App name"
        description="Shown in the dashboard. Clients identify the app by its write key, so renaming is safe."
        footer="Up to 64 characters."
        action={
          <Button type="submit" variant="primary" loading={update.isPending} disabled={name.trim() === app.name || !name.trim()}>
            Save
          </Button>
        }
      >
        <Field label={<span className="sr-only">Name</span>} error={errorText(update.error)}>
          <Input aria-label="App name" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        </Field>
      </SettingsCard>
    </form>
  )
}

function WriteKeyCard({ app }: { app: App }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [revealed, setRevealed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rotate = useMutation({
    mutationFn: () => api.rotateKey(app.id),
    onSuccess: ({ app: updated }) => {
      queryClient.setQueryData(['app', app.id], { app: updated })
      setConfirming(false)
      setRevealed(true)
      toast('Write key rotated')
    },
  })
  const masked = `${app.writeKey.slice(0, 7)}${'•'.repeat(20)}${app.writeKey.slice(-4)}`
  return (
    <SettingsCard
      title="Write key"
      description="Clients send events with this key. It only allows writing events, so it’s safe to embed in apps and websites."
      footer="Rotating invalidates the current key immediately."
      action={
        <Button icon={<RefreshIcon />} onClick={() => setConfirming(true)}>
          Rotate key
        </Button>
      }
    >
      <div className="flex h-9 max-w-lg items-center gap-1 rounded-md border border-border bg-subtle pr-0.5 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{revealed ? app.writeKey : masked}</code>
        <IconButton label={revealed ? 'Hide key' : 'Reveal key'} onClick={() => setRevealed(!revealed)}>
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </IconButton>
        <CopyButton value={app.writeKey} label="Copy write key" />
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Rotate write key?"
        description="The current key stops working right away. Clients still using it will get 401 errors until they ship the new key."
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" loading={rotate.isPending} onClick={() => rotate.mutate()}>
              Rotate key
            </Button>
          </>
        }
      />
    </SettingsCard>
  )
}

function SchemaModeCard({ app }: { app: App }) {
  const [mode, setMode] = useState<SchemaMode>(app.schemaMode)
  const update = useUpdateApp(app.id)
  useEffect(() => setMode(app.schemaMode), [app.schemaMode])
  return (
    <SettingsCard
      title="Schema mode"
      description="Decide what happens to events that don’t match your definitions on the Events tab."
      footer="Changes apply to new events within about a minute."
      action={
        <Button variant="primary" loading={update.isPending} disabled={mode === app.schemaMode} onClick={() => update.mutate({ schemaMode: mode })}>
          Save
        </Button>
      }
    >
      <RadioCards name="settings-schema-mode" value={mode} onChange={setMode} options={SCHEMA_MODES} />
    </SettingsCard>
  )
}

const pct = (rate: number) => String(Math.round(rate * 10000) / 100)

function SamplingCard({ app }: { app: App }) {
  const update = useUpdateApp(app.id)
  const definitions = useQuery({ queryKey: ['definitions', app.id], queryFn: () => api.definitions(app.id) })
  const [mode, setMode] = useState<SamplingConfig['mode']>(app.sampling.mode)
  const [strategy, setStrategy] = useState<SamplingConfig['strategy']>(app.sampling.strategy)
  const [rate, setRate] = useState(pct(app.sampling.rate))
  const [overrides, setOverrides] = useState(app.sampling.overrides.map((o) => ({ event: o.event, rate: pct(o.rate) })))
  useEffect(() => {
    setMode(app.sampling.mode)
    setStrategy(app.sampling.strategy)
    setRate(pct(app.sampling.rate))
    setOverrides(app.sampling.overrides.map((o) => ({ event: o.event, rate: pct(o.rate) })))
  }, [app.sampling])

  const names = [...new Set([...(definitions.data?.definitions.map((d) => d.name) ?? []), ...(definitions.data?.undefinedEvents.map((d) => d.name) ?? [])])]
  const r = Number(rate)
  const rateValid = r > 0 && r <= 100
  const overridesValid = overrides.every((o) => o.event.trim() && Number(o.rate) >= 0 && Number(o.rate) <= 100 && o.rate !== '')
  const next: SamplingConfig = {
    mode,
    strategy,
    rate: rateValid ? r / 100 : app.sampling.rate,
    overrides: overrides.filter((o) => o.event.trim()).map((o) => ({ event: o.event.trim(), rate: Number(o.rate) / 100 })),
  }
  const dirty = JSON.stringify(next) !== JSON.stringify(app.sampling)

  return (
    <SettingsCard
      title="Sampling"
      description="Keep every event, or only a share of them to cut storage and cost at high volume. Charts scale sampled data back up, so totals are estimates."
      footer={mode === 'sampled' ? 'Applies to new events within about a minute. $error is always kept in full unless overridden.' : 'Every event is stored.'}
      action={
        <Button variant="primary" loading={update.isPending} disabled={!dirty || (mode === 'sampled' && (!rateValid || !overridesValid))} onClick={() => update.mutate({ sampling: next })}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <RadioCards
          name="sampling-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'full', label: 'Full', description: 'Store every event. Exact numbers.' },
            { value: 'sampled', label: 'Sampled', description: 'Store a share of events; totals are estimated.' },
          ]}
        />
        {mode === 'sampled' && (
          <>
            <Field label="Strategy">
              <RadioCards
                name="sampling-strategy"
                value={strategy}
                onChange={setStrategy}
                options={[
                  { value: 'user', label: 'By user (recommended)', description: 'Keep all events of a share of users. Funnels and per-user metrics stay accurate.' },
                  { value: 'event', label: 'By event', description: 'Keep a share of each event independently. User counts become lower bounds.' },
                ]}
              />
            </Field>
            <Field label={strategy === 'user' ? 'Users to keep' : 'Events to keep'} error={rateValid ? null : 'Enter a percentage between 0.01 and 100'}>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Sampling rate in percent"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={100}
                  step="any"
                  value={rate}
                  aria-invalid={!rateValid || undefined}
                  onChange={(e) => setRate(e.target.value)}
                  className="!w-28 tabular"
                />
                <span className="text-sm text-muted">%</span>
              </div>
            </Field>
            <Field label="Per-event rates" hint="For example keep purchase at 100% and screen_view at 5%. 0% drops an event entirely.">
              <div className="flex flex-col gap-2">
                <datalist id="sampling-events">
                  {names.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {overrides.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      mono
                      aria-label="Event name"
                      list="sampling-events"
                      placeholder="event_name"
                      spellCheck={false}
                      autoComplete="off"
                      value={o.event}
                      onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, event: e.target.value } : x)))}
                      className="max-w-xs"
                    />
                    <Input
                      aria-label="Rate in percent"
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={o.rate}
                      onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                      className="!w-24 tabular"
                    />
                    <span className="text-sm text-muted">%</span>
                    <IconButton label="Remove override" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}>
                      <TrashIcon />
                    </IconButton>
                  </div>
                ))}
                <div>
                  <Button variant="tertiary" className="-ml-2" icon={<PlusIcon />} disabled={overrides.length >= 50} onClick={() => setOverrides([...overrides, { event: '', rate: '100' }])}>
                    Add event rate
                  </Button>
                </div>
              </div>
            </Field>
          </>
        )}
        {update.error && <Note tone="danger">{errorText(update.error)}</Note>}
      </div>
    </SettingsCard>
  )
}

function RetentionCard({ app }: { app: App }) {
  const [days, setDays] = useState(String(app.retentionDays))
  const update = useUpdateApp(app.id)
  useEffect(() => setDays(String(app.retentionDays)), [app.retentionDays])
  const n = Number(days)
  const valid = Number.isInteger(n) && n >= 1 && n <= 3650
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) update.mutate({ retentionDays: n })
      }}
    >
      <SettingsCard
        title="Data retention"
        description="Events older than this are deleted by the daily cleanup job."
        footer="Between 1 and 3,650 days."
        action={
          <Button type="submit" variant="primary" loading={update.isPending} disabled={!valid || n === app.retentionDays}>
            Save
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <Input
            aria-label="Retention in days"
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            value={days}
            aria-invalid={!valid || undefined}
            onChange={(e) => setDays(e.target.value)}
            className="!w-28 tabular"
          />
          <span className="text-sm text-muted">days</span>
        </div>
      </SettingsCard>
    </form>
  )
}

function DeleteCard({ app }: { app: App }) {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const remove = useMutation({
    mutationFn: () => api.deleteApp(app.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps'] })
      toast(`Deleted ${app.name}`)
      navigate('/')
    },
  })
  return (
    <SettingsCard
      tone="danger"
      title="Delete app"
      description="Permanently delete this app, its definitions and all of its events. This can’t be undone."
      action={
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete app
        </Button>
      }
    >
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false)
          setConfirm('')
        }}
        title="Delete app"
        description={
          <>
            The write key stops working immediately and all events are removed. Type <strong className="font-medium text-fg">{app.name}</strong> to
            confirm.
          </>
        }
        onSubmit={() => confirm === app.name && remove.mutate()}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={confirm !== app.name} loading={remove.isPending}>
              Delete
            </Button>
          </>
        }
      >
        <Input aria-label="App name" autoComplete="off" spellCheck={false} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {remove.error && <Note tone="danger">{errorText(remove.error)}</Note>}
      </Dialog>
    </SettingsCard>
  )
}

export function AppSettingsPage({ appId }: { appId: string }) {
  const query = useQuery({ queryKey: ['app', appId], queryFn: () => api.app(appId) })
  const app = query.data?.app
  return (
    <Page title="Settings" description={app ? `Created ${formatDate(app.createdAt)} · ID ${app.id}` : undefined}>
      {!app ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-6">
          <NameCard app={app} />
          <WriteKeyCard app={app} />
          <SettingsCard title="Send events" description="Any HTTP client works. Batch events, retry on network errors and include a unique id per event so retries are deduplicated.">
            <Quickstart writeKey={app.writeKey} />
          </SettingsCard>
          <SchemaModeCard app={app} />
          <SamplingCard app={app} />
          <RetentionCard app={app} />
          <DeleteCard app={app} />
        </div>
      )}
    </Page>
  )
}
