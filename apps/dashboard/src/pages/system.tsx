import type { ApiToken } from '@serverless-analytics/core/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Dialog } from '../components/dialog'
import { PlusIcon } from '../components/icons'
import { Page } from '../components/layout'
import { Badge, Button, CopyButton, Field, Input, SettingsCard, Skeleton } from '../components/ui'
import { formatRelative } from '../lib/format'
import { api } from '../lib/api'

const QUEUE_NOTES: Record<string, string> = {
  direct: 'Events are written during the request. Simple and durable; each request waits for the database.',
  background: 'The response is sent first and events are written right after. Fastest, but a failed write is lost.',
  cloudflare: 'Events go through Cloudflare Queues and are written in batches, with retries and a dead-letter queue.',
  qstash: 'Events go through Upstash QStash, which calls back this deployment with retries.',
}

const KV_NOTES: Record<string, string> = {
  cloudflare: 'Cloudflare KV caches write keys and definitions across the edge.',
  upstash: 'Upstash Redis caches write keys and definitions.',
  memory: 'Per-instance memory cache only. Fine for small deployments.',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[160px_1fr] sm:gap-6">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function TokensCard() {
  const queryClient = useQueryClient()
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: api.tokens })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const create = useMutation({
    mutationFn: () => api.createToken(name.trim()),
    onSuccess: (res) => {
      setSecret(res.secret)
      queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: () => {
      setRevoking(null)
      queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })
  const close = () => {
    setCreating(false)
    setSecret(null)
    setName('')
    create.reset()
  }
  const list = tokens.data?.tokens ?? []

  return (
    <SettingsCard
      title="Access tokens"
      description={
        <>
          Used by <code className="font-mono text-fg">serverless-analytics-cli</code> and agents. <code className="font-mono text-fg">sa login</code>{' '}
          creates one after you approve it in the browser; create one here for CI. Tokens have full access.
        </>
      }
      footer={`${list.length} active token${list.length === 1 ? '' : 's'}`}
      action={
        <Button icon={<PlusIcon />} onClick={() => setCreating(true)}>
          Create token
        </Button>
      }
    >
      {list.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-4 px-3 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="font-mono text-xs text-muted">{t.prefix}…</div>
              </div>
              <div className="hidden text-right text-xs text-muted sm:block">
                <div>Created {formatRelative(t.createdAt)}</div>
                <div>{t.lastUsedAt ? `Used ${formatRelative(t.lastUsedAt)}` : 'Never used'}</div>
              </div>
              <Button variant="tertiary" className="!text-danger" onClick={() => setRevoking(t)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={creating}
        onClose={close}
        title={secret ? 'Copy your token' : 'Create access token'}
        description={secret ? 'This is the only time the token is shown.' : 'For CI or scripts: pass it as SA_TOKEN, or as Authorization: Bearer <token>.'}
        onSubmit={() => !secret && name.trim() && create.mutate()}
        footer={
          secret ? (
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
                Create
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-subtle pr-0.5 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{secret}</code>
            <CopyButton value={secret} label="Copy token" />
          </div>
        ) : (
          <Field label="Name" htmlFor="token-name">
            <Input id="token-name" autoFocus maxLength={64} placeholder="GitHub Actions" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
      </Dialog>
      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Revoke token?"
        description={`Anything using “${revoking?.name ?? ''}” stops working immediately.`}
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>Cancel</Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>
              Revoke
            </Button>
          </>
        }
      />
    </SettingsCard>
  )
}

export function SystemPage() {
  const queryClient = useQueryClient()
  const system = useQuery({ queryKey: ['system'], queryFn: api.system })
  const migrate = useMutation({ mutationFn: api.migrate, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system'] }) })
  const s = system.data

  return (
    <Page title="Settings" description="Deployment configuration. Drivers are chosen with environment variables — see docs/CONFIGURATION.md.">
      {!s ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-6">
          <SettingsCard title="Deployment">
            <dl>
              <Row label="Runtime">
                <span className="capitalize">{s.runtime}</span>
              </Row>
              <Row label="Version">
                <span className="font-mono text-[13px]">{s.version}</span>
              </Row>
            </dl>
          </SettingsCard>

          <SettingsCard
            title="Storage"
            footer={
              s.migrations.pending.length ? `${s.migrations.pending.length} migration(s) pending` : `Schema up to date · ${s.migrations.applied.length} migration(s) applied`
            }
            action={
              <Button onClick={() => migrate.mutate()} loading={migrate.isPending} disabled={s.migrations.pending.length === 0}>
                Run migrations
              </Button>
            }
          >
            <dl>
              <Row label="Database">
                <span className="font-mono text-[13px]">{s.database.driver}</span> <span className="text-muted">· {s.database.dialect}</span>
              </Row>
              <Row label="Cache (KV)">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[13px]">{s.kv.driver}</span>
                  <span className="text-[13px] text-muted">{KV_NOTES[s.kv.driver]}</span>
                </div>
              </Row>
              <Row label="Queue">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[13px]">{s.queue.driver}</span>
                  <span className="text-[13px] text-muted">{QUEUE_NOTES[s.queue.driver]}</span>
                </div>
              </Row>
              <Row label="Migrations">
                <div className="flex flex-wrap gap-1.5">
                  {s.migrations.applied.map((m) => (
                    <Badge key={m} tone="green">
                      {m}
                    </Badge>
                  ))}
                  {s.migrations.pending.map((m) => (
                    <Badge key={m} tone="amber">
                      {m} · pending
                    </Badge>
                  ))}
                </div>
              </Row>
            </dl>
          </SettingsCard>

          <TokensCard />

        </div>
      )}
    </Page>
  )
}
