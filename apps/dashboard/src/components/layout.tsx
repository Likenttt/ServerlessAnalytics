import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { api } from '../lib/api'
import { useTheme, type ThemePreference } from '../lib/theme'
import { CheckIcon, ChevronUpDownIcon, GearIcon, LogOutIcon, Logo, MonitorIcon, MoonIcon, PlusIcon, SunIcon } from './icons'
import { cx } from './ui'

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

const menuItem = 'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-hover focus-visible:bg-hover'
const popover = 'absolute z-30 mt-2 rounded-xl border border-border bg-bg p-1.5 shadow-[var(--shadow-popover)]'

function AppSwitcher({ appId }: { appId: string }) {
  const { open, setOpen, ref } = usePopover()
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps })
  const current = apps.data?.apps.find((a) => a.id === appId)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-hover"
      >
        <span className="max-w-[40vw] truncate">{current?.name ?? '…'}</span>
        <ChevronUpDownIcon className="text-muted" />
      </button>
      {open && (
        <div role="menu" className={cx(popover, 'left-0 w-64')}>
          <div className="px-2 pt-1 pb-1.5 text-xs text-muted">Apps</div>
          {apps.data?.apps.map((a) => (
            <Link key={a.id} href={`/apps/${a.id}`} role="menuitem" className={menuItem} onClick={() => setOpen(false)}>
              <span className="flex-1 truncate">{a.name}</span>
              {a.id === appId && <CheckIcon />}
            </Link>
          ))}
          <div className="my-1 h-px bg-border" />
          <Link href="/?new=1" role="menuitem" className={cx(menuItem, 'text-muted')} onClick={() => setOpen(false)}>
            <PlusIcon />
            New app
          </Link>
        </div>
      )}
    </div>
  )
}

function ThemeSwitcher() {
  const [theme, setTheme] = useTheme()
  const options: { value: ThemePreference; label: string; icon: ReactNode }[] = [
    { value: 'system', label: 'System', icon: <MonitorIcon size={14} /> },
    { value: 'light', label: 'Light', icon: <SunIcon size={14} /> },
    { value: 'dark', label: 'Dark', icon: <MoonIcon size={14} /> },
  ]
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-full border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => setTheme(o.value)}
          className={cx(
            'flex h-6 w-6 items-center justify-center rounded-full transition-colors',
            theme === o.value ? 'bg-active text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

function AccountMenu() {
  const { open, setOpen, ref } = usePopover()
  const queryClient = useQueryClient()
  const signOut = async () => {
    await api.logout().catch(() => {})
    queryClient.clear()
    window.location.assign('/')
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-hover text-xs font-semibold text-fg hover:border-border-strong"
      >
        A
      </button>
      {open && (
        <div role="menu" className={cx(popover, 'right-0 w-60')}>
          <div className="px-2 pt-1 pb-2">
            <div className="text-sm font-medium">Admin</div>
            <div className="text-[13px] text-muted">Single-user deployment</div>
          </div>
          <Link href="/settings" role="menuitem" className={menuItem} onClick={() => setOpen(false)}>
            <GearIcon className="text-muted" />
            Settings
          </Link>
          <div className="flex h-10 items-center justify-between px-2 text-sm">
            Theme
            <ThemeSwitcher />
          </div>
          <div className="my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={menuItem} onClick={signOut}>
            <LogOutIcon className="text-muted" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

const TABS = [
  { href: '', label: 'Overview' },
  { href: '/explore', label: 'Explore' },
  { href: '/live', label: 'Live' },
  { href: '/events', label: 'Events' },
  { href: '/settings', label: 'Settings' },
]

export function Header({ appId }: { appId?: string }) {
  const [location] = useLocation()
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight" aria-label="All apps">
          <Logo />
          <span className={cx(appId && 'hidden sm:inline')}>Analytics</span>
        </Link>
        {appId && (
          <>
            <span className="px-1 text-xl font-light text-border-strong" aria-hidden="true">
              /
            </span>
            <AppSwitcher appId={appId} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <AccountMenu />
        </div>
      </div>
      {appId && (
        <nav aria-label="App" className="mx-auto -mb-px flex max-w-[1200px] gap-1 overflow-x-auto px-2 sm:px-4">
          {TABS.map((tab) => {
            const href = `/apps/${appId}${tab.href}`
            const active = tab.href === '' ? location === href : location.startsWith(href)
            return (
              <Link
                key={tab.label}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex h-11 items-center px-2.5 text-sm whitespace-nowrap transition-colors',
                  active ? 'text-fg' : 'text-muted hover:text-fg',
                )}
              >
                <span className="rounded-md px-1 py-1">{tab.label}</span>
                {active && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-fg" />}
              </Link>
            )
          })}
        </nav>
      )}
    </header>
  )
}

export function Page({ title, description, actions, children }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
      {(title || actions) && (
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {title && <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>}
            {description && <p className="text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </main>
  )
}
