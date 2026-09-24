import type { App, SchemaMode } from '@serverless-analytics/core/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { Dialog } from '../components/dialog'
import { EyeIcon, EyeOffIcon, RefreshIcon } from '../components/icons'
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
    mutationFn: (patch: Partial<Pick<App, 'name' | 'schemaMode' | 'retentionDays'>>) => api.updateApp(appId, patch),
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
          <RetentionCard app={app} />
          <DeleteCard app={app} />
        </div>
      )}
    </Page>
  )
}
