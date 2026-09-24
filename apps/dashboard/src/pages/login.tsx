import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Logo } from '../components/icons'
import { Button, Field, Input } from '../components/ui'
import { api, ApiError } from '../lib/api'

export function LoginPage() {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.login(password)
      queryClient.setQueryData(['session'], { authenticated: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-subtle px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo size={40} />
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Analytics</h1>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border bg-bg p-6">
          <Field label="Password" htmlFor="password" error={error}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            {loading ? 'Signing in…' : 'Continue'}
          </Button>
        </form>
        <p className="mt-6 text-center text-[13px] text-muted">
          The password is the <code className="font-mono text-fg">ADMIN_PASSWORD</code> set for this deployment.
        </p>
      </div>
    </main>
  )
}
