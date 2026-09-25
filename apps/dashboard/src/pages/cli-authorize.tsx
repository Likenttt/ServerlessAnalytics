import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CheckIcon, Logo, XIcon } from '../components/icons'
import { Button, Field, Input, Note, Skeleton } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatRelative } from '../lib/format'
import { useSearchParams } from '../lib/url'

// Opened from `sa login`. The code shown here must match the one in the terminal.

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-subtle px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={40} />
        </div>
        <div className="rounded-xl border border-border bg-bg">{children}</div>
      </div>
    </main>
  )
}

function Done({ approved }: { approved: boolean }) {
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${approved ? 'bg-success-bg text-success' : 'bg-hover text-muted'}`}>
          {approved ? <CheckIcon /> : <XIcon />}
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{approved ? 'CLI authorized' : 'Request denied'}</h1>
        <p className="text-sm text-muted">
          {approved
            ? 'You can close this tab and return to your terminal. Revoke access anytime under Settings → Access tokens.'
            : 'The CLI was not given access. You can close this tab.'}
        </p>
      </div>
    </AuthShell>
  )
}

export function CliAuthorizePage() {
  const queryClient = useQueryClient()
  const { params, set } = useSearchParams()
  const code = (params.get('code') ?? '').toUpperCase()
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<'approved' | 'denied' | null>(null)

  const request = useQuery({ queryKey: ['cli-request', code], queryFn: () => api.cliRequest(code), enabled: Boolean(code), retry: false })
  const approve = useMutation({
    mutationFn: () => api.cliApprove(code),
    onSuccess: () => {
      setResult('approved')
      queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })
  const deny = useMutation({ mutationFn: () => api.cliDeny(code), onSuccess: () => setResult('denied') })

  if (result) return <Done approved={result === 'approved'} />

  if (!code) {
    return (
      <AuthShell>
        <form
          className="flex flex-col gap-4 p-6"
          onSubmit={(e) => {
            e.preventDefault()
            set('code', typed.trim().toUpperCase())
          }}
        >
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Authorize the CLI</h1>
            <p className="text-sm text-muted">
              Enter the code shown by <code className="font-mono text-fg">sa login</code>.
            </p>
          </div>
          <Field label="Code" htmlFor="cli-code">
            <Input id="cli-code" mono autoFocus autoComplete="off" spellCheck={false} placeholder="ABCD-EFGH" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" size="md" disabled={!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(typed.trim())}>
            Continue
          </Button>
        </form>
      </AuthShell>
    )
  }

  const error = request.error ?? approve.error ?? deny.error
  return (
    <AuthShell>
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Authorize the CLI</h1>
          <p className="text-sm text-muted">
            A command-line client is asking for access to this deployment. It will be able to read all data and change settings, just like
            you in the dashboard.
          </p>
        </div>
        {request.isPending ? (
          <Skeleton className="h-24" />
        ) : request.data ? (
          <>
            <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-subtle py-5">
              <span className="text-xs text-muted">Confirm this matches your terminal</span>
              <span className="font-mono text-2xl font-semibold tracking-[0.2em]">{request.data.userCode}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-muted">Client</dt>
              <dd className="font-medium">{request.data.name}</dd>
              <dt className="text-muted">Requested</dt>
              <dd>{formatRelative(request.data.createdAt)}</dd>
            </dl>
          </>
        ) : null}
        {error && <Note tone="danger">{error instanceof ApiError ? error.message : 'Something went wrong'}</Note>}
      </div>
      {request.data && (
        <div className="flex justify-end gap-2 border-t border-border bg-subtle px-6 py-3">
          <Button onClick={() => deny.mutate()} loading={deny.isPending} disabled={approve.isPending}>
            Deny
          </Button>
          <Button variant="primary" onClick={() => approve.mutate()} loading={approve.isPending} disabled={deny.isPending}>
            Authorize
          </Button>
        </div>
      )}
    </AuthShell>
  )
}
