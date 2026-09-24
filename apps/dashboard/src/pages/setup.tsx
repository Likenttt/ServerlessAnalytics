import type { SystemResponse } from '@serverless-analytics/core/types'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Logo } from '../components/icons'
import { Badge, Button, Note } from '../components/ui'
import { api, ApiError } from '../lib/api'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-subtle px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <Logo size={40} />
        </div>
        <div className="rounded-xl border border-border bg-bg">{children}</div>
      </div>
    </main>
  )
}

export function ConfigErrorPage({ message }: { message: string }) {
  const problems = message.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
  return (
    <Shell>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Configuration needed</h1>
          <p className="text-sm text-muted">This deployment is missing required settings. Fix the environment variables below and redeploy.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {(problems.length ? problems : [message]).map((p) => (
            <li key={p} className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 font-mono text-[12.5px] text-danger">
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-border bg-subtle px-6 py-3 text-[13px] text-muted">
        See <code className="font-mono text-fg">docs/CONFIGURATION.md</code> for every option.
      </div>
    </Shell>
  )
}

export function SetupPage({ system }: { system: SystemResponse }) {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fresh = system.migrations.applied.length === 0

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      await api.migrate()
      await queryClient.invalidateQueries({ queryKey: ['system'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Migration failed')
      setRunning(false)
    }
  }

  return (
    <Shell>
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{fresh ? 'Initialize the database' : 'Database update available'}</h1>
          <p className="text-sm text-muted">
            {fresh
              ? 'Create the tables this deployment needs. This is safe to run more than once.'
              : 'A newer schema is available. Apply it to keep using the dashboard.'}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">Database</dt>
          <dd className="font-mono text-[13px]">
            {system.database.driver} <span className="text-muted">({system.database.dialect})</span>
          </dd>
          <dt className="text-muted">Pending</dt>
          <dd className="flex flex-wrap gap-1.5">
            {system.migrations.pending.map((m) => (
              <Badge key={m}>{m}</Badge>
            ))}
          </dd>
        </dl>
        {error && <Note tone="danger">{error}</Note>}
      </div>
      <div className="flex justify-end border-t border-border bg-subtle px-6 py-3">
        <Button variant="primary" onClick={run} loading={running}>
          {running ? 'Applying…' : fresh ? 'Initialize database' : 'Apply update'}
        </Button>
      </div>
    </Shell>
  )
}
