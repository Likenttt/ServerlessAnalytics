import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Page } from '../components/layout'
import { Badge, Button, SettingsCard, Skeleton } from '../components/ui'
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

          <SettingsCard
            title="Access"
            description="This is a single-user deployment protected by ADMIN_PASSWORD. Changing the password signs out every session."
          />
        </div>
      )}
    </Page>
  )
}
