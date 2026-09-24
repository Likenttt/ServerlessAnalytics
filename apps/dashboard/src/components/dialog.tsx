import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { XIcon } from './icons'
import { cx, IconButton } from './ui'

// Native <dialog>: focus trapping, Escape and top-layer stacking come for free.

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  onSubmit,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  width?: 'md' | 'lg'
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const body = (
    <>
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <div className="text-sm text-muted">{description}</div>}
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
          <XIcon />
        </IconButton>
      </div>
      <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle px-6 py-3">{footer}</div>}
    </>
  )

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cx(
        'm-auto w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-border bg-bg p-0 text-fg shadow-[var(--shadow-popover)]',
        width === 'lg' ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open &&
        (onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit(e)
            }}
          >
            {body}
          </form>
        ) : (
          body
        ))}
    </dialog>
  )
}
