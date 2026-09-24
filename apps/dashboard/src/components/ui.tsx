import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { CheckIcon, ChevronDownIcon, CopyIcon, InfoIcon, WarningIcon } from './icons'

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

// Buttons --------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-inverse text-inverse-fg hover:bg-inverse-hover',
  secondary: 'bg-bg text-fg border border-border-strong hover:bg-hover',
  tertiary: 'text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:opacity-90',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 gap-1.5 text-[13px]',
  md: 'h-10 px-4 gap-2 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', loading, icon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
})

export function IconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  return (
    <Button
      variant="tertiary"
      aria-label={label}
      title={label}
      className={cx('!h-8 !w-8 !px-0 text-muted hover:text-fg', className)}
      {...props}
    />
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Form controls ---------------------------------------------------------------

const control =
  'w-full rounded-md border border-border-strong bg-bg text-fg placeholder:text-faint transition-colors hover:border-faint focus-visible:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--focus)_25%,transparent)] disabled:opacity-60 disabled:cursor-not-allowed aria-[invalid=true]:border-danger'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input(
  { className, mono, ...props },
  ref,
) {
  return <input ref={ref} className={cx(control, 'h-9 px-3 text-sm', mono && 'font-mono text-[13px]', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cx(control, 'min-h-20 px-3 py-2 text-sm', className)} {...props} />
})

export function Select({ className, children, size = 'sm', ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: Size }) {
  return (
    <div className={cx('relative inline-flex', className)}>
      <select
        className={cx(
          control,
          'cursor-pointer appearance-none pr-8 pl-3 font-medium',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
          <WarningIcon size={14} />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md border border-border-strong p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-full rounded-[4px] px-2.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-active text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; description: string }[]
  name: string
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
            value === o.value ? 'border-fg bg-subtle' : 'border-border hover:border-border-strong',
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5 accent-[var(--fg)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{o.label}</span>
            <span className="text-[13px] text-muted">{o.description}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

// Surfaces ----------------------------------------------------------------------

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-lg border border-border bg-bg', className)} {...props}>
      {children}
    </div>
  )
}

/** Vercel-style settings section: title, description, body and a footer with an action. */
export function SettingsCard({
  title,
  description,
  children,
  footer,
  action,
  tone = 'default',
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'danger'
}) {
  return (
    <section className={cx('overflow-hidden rounded-lg border bg-bg', tone === 'danger' ? 'border-danger-border' : 'border-border')}>
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <div className="text-sm text-muted">{description}</div>}
        {children && <div className="mt-1">{children}</div>}
      </div>
      {(footer || action) && (
        <div
          className={cx(
            'flex min-h-14 flex-wrap items-center justify-between gap-3 border-t px-6 py-3 text-[13px] text-muted',
            tone === 'danger' ? 'border-danger-border bg-danger-bg' : 'border-border bg-subtle',
          )}
        >
          <div>{footer}</div>
          {action}
        </div>
      )}
    </section>
  )
}

type BadgeTone = 'gray' | 'green' | 'amber' | 'red' | 'blue'
const BADGE: Record<BadgeTone, string> = {
  gray: 'bg-hover text-muted',
  green: 'bg-success-bg text-success',
  amber: 'bg-warning-bg text-warning',
  red: 'bg-danger-bg text-danger',
  blue: 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent',
}

export function Badge({ tone = 'gray', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap', BADGE[tone], className)}>
      {children}
    </span>
  )
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const styles = {
    info: 'border-border bg-subtle text-fg',
    warning: 'border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-warning-bg text-warning',
    danger: 'border-danger-border bg-danger-bg text-danger',
  }[tone]
  return (
    <div className={cx('flex gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-5', styles)}>
      <span className="mt-0.5 shrink-0">{tone === 'info' ? <InfoIcon size={14} /> : <WarningIcon size={14} />}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-hover', className)} aria-hidden="true" />
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {description && <div className="max-w-md text-[13px] text-muted">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-subtle px-1 font-sans text-[11px] text-muted">
      {children}
    </kbd>
  )
}

// Copy & code ------------------------------------------------------------------

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return { copied, copy }
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy()
  return (
    <IconButton label={copied ? 'Copied' : label} onClick={() => copy(value)} className={className}>
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </IconButton>
  )
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="group relative rounded-md border border-border bg-subtle">
      {label && <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted">{label}</div>}
      <pre className="overflow-x-auto p-3 pr-12 font-mono text-[12.5px] leading-5 text-fg">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label="Copy code" className={cx('absolute right-1.5', label ? 'top-9' : 'top-1.5')} />
    </div>
  )
}
