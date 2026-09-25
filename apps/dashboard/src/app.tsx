import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Redirect, Route, Switch, useParams } from 'wouter'
import { Header } from './components/layout'
import { Spinner } from './components/ui'
import { api } from './lib/api'
import { AppSettingsPage } from './pages/app-settings'
import { AppsPage } from './pages/apps'
import { CliAuthorizePage } from './pages/cli-authorize'
import { DefinitionsPage } from './pages/definitions'
import { ErrorDetailPage, ErrorsPage } from './pages/errors'
import { ExplorePage } from './pages/explore'
import { FunnelsPage } from './pages/funnels'
import { LivePage } from './pages/live'
import { LoginPage } from './pages/login'
import { OAuthAuthorizePage } from './pages/oauth-authorize'
import { OverviewPage } from './pages/overview'
import { ConfigErrorPage, SetupPage } from './pages/setup'
import { SystemPage } from './pages/system'

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted" role="status" aria-label="Loading">
      <Spinner size={20} />
    </div>
  )
}

function AppRoutes() {
  const { appId } = useParams<{ appId: string }>()
  const app = useQuery({ queryKey: ['app', appId], queryFn: () => api.app(appId) })
  if (app.isError) return <Redirect to="/" replace />
  return (
    <>
      <Header appId={appId} />
      <Switch>
        <Route path="/apps/:appId">
          <OverviewPage appId={appId} />
        </Route>
        <Route path="/apps/:appId/explore">
          <ExplorePage appId={appId} />
        </Route>
        <Route path="/apps/:appId/funnels">
          <FunnelsPage appId={appId} />
        </Route>
        <Route path="/apps/:appId/errors">
          <ErrorsPage appId={appId} />
        </Route>
        <Route path="/apps/:appId/errors/:fingerprint">
          {(params: { fingerprint: string }) => <ErrorDetailPage appId={appId} fingerprint={params.fingerprint} />}
        </Route>
        <Route path="/apps/:appId/live">
          <LivePage appId={appId} />
        </Route>
        <Route path="/apps/:appId/events">
          <DefinitionsPage appId={appId} />
        </Route>
        <Route path="/apps/:appId/settings">
          <AppSettingsPage appId={appId} />
        </Route>
      </Switch>
    </>
  )
}

function Authenticated() {
  const system = useQuery({ queryKey: ['system'], queryFn: api.system })
  if (system.isPending) return <FullScreenSpinner />
  if (system.data && system.data.migrations.pending.length > 0) return <SetupPage system={system.data} />
  return (
    <Switch>
      <Route path="/">
        <Header />
        <AppsPage />
      </Route>
      <Route path="/cli/authorize">
        <CliAuthorizePage />
      </Route>
      <Route path="/authorize">
        <OAuthAuthorizePage />
      </Route>
      <Route path="/settings">
        <Header />
        <SystemPage />
      </Route>
      <Route path="/apps/:appId">
        <AppRoutes />
      </Route>
      <Route path="/apps/:appId/*">
        <AppRoutes />
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity })

  useEffect(() => {
    const onUnauthorized = () => queryClient.setQueryData(['session'], { authenticated: false })
    window.addEventListener('sa:unauthorized', onUnauthorized)
    return () => window.removeEventListener('sa:unauthorized', onUnauthorized)
  }, [queryClient])

  if (session.isPending) return <FullScreenSpinner />
  if (session.data?.configError) return <ConfigErrorPage message={session.data.configError} />
  if (!session.data?.authenticated) return <LoginPage />
  return <Authenticated />
}
