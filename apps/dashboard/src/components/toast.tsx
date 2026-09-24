import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckIcon, WarningIcon } from './icons'

interface Toast {
  id: number
  message: string
  tone: 'success' | 'error'
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, message, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg border border-border bg-bg px-4 py-3 text-sm shadow-[var(--shadow-popover)]"
          >
            {t.tone === 'success' ? <CheckIcon className="shrink-0 text-success" /> : <WarningIcon className="shrink-0 text-danger" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
