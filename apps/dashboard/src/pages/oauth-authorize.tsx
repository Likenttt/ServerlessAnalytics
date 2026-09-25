import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearch } from 'wouter'
import { CheckIcon, XIcon } from '../components/icons'
import { Button, Note, Skeleton } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { AuthShell } from './cli-authorize'

// Opened by an MCP client through /oauth/authorize, after the request was validated.

/** Where the browser goes back to; custom schemes (cursor://…) are shown as-is. */
function destination(uri: string): string {
  try {
    const url = new URL(uri)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return uri
  }
}

function Done({ approved, name }: { approved: boolean; name: string }) {
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${approved ? 'bg-success-bg text-success' : 'bg-hover text-muted'}`}>
          {approved ? <CheckIcon /> : <XIcon />}
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{approved ? `${name} connected` : 'Request denied'}</h1>
        <p className="text-sm text-muted">
          {approved
            ? 'Returning you to the app. You can close this tab once it continues. Revoke access anytime under Settings → Authorized apps.'
            : 'The app was not given access. You can close this tab.'}
        </p>
      </div>
    </AuthShell>
  )
}

export function OAuthAuthorizePage() {
  const queryClient = useQueryClient()
  const search = useSearch()
  const [params] = useState(() => Object.fromEntries(new URLSearchParams(search)))
  const [result, setResult] = useState<'approved' | 'denied' | null>(null)

  const request = useQuery({
    queryKey: ['oauth-request', search],
    queryFn: () => api.oauthRequest(`?${search}`),
    retry: false,
    staleTime: Infinity,
  })
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.oauthDecide(params, approve),
    onSuccess: (res, approve) => {
      setResult(approve ? 'approved' : 'denied')
      if (approve) queryClient.invalidateQueries({ queryKey: ['oauth-grants'] })
      window.location.assign(res.redirectTo)
    },
  })

  const name = request.data?.client.name ?? 'MCP client'
  if (result) return <Done approved={result === 'approved'} name={name} />

  const error = request.error ?? decide.error
  return (
    <AuthShell>
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{request.data ? `Authorize ${name}` : 'Authorize app'}</h1>
          <p className="text-sm text-muted">
            An app is asking to connect to this deployment over MCP. It will be able to read all data and change settings, just like you
            in the dashboard.
          </p>
        </div>
        {request.isPending ? (
          <Skeleton className="h-24" />
        ) : request.data ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-muted">App</dt>
              <dd className="min-w-0 truncate font-medium">{name}</dd>
              {request.data.client.uri && (
                <>
                  <dt className="text-muted">Website</dt>
                  <dd className="min-w-0 truncate">{destination(request.data.client.uri)}</dd>
                </>
              )}
              <dt className="text-muted">Returns to</dt>
              <dd className="min-w-0 truncate font-mono text-[13px]">{destination(request.data.redirectUri)}</dd>
            </dl>
            <Note tone="warning">The app chooses its own name. Only continue if you just started connecting it yourself.</Note>
          </>
        ) : null}
        {error && <Note tone="danger">{error instanceof ApiError ? error.message : 'Something went wrong'}</Note>}
      </div>
      {request.data && (
        <div className="flex justify-end gap-2 border-t border-border bg-subtle px-6 py-3">
          <Button onClick={() => decide.mutate(false)} loading={decide.isPending && decide.variables === false} disabled={decide.isPending}>
            Deny
          </Button>
          <Button variant="primary" onClick={() => decide.mutate(true)} loading={decide.isPending && decide.variables === true} disabled={decide.isPending}>
            Authorize
          </Button>
        </div>
      )}
    </AuthShell>
  )
}
