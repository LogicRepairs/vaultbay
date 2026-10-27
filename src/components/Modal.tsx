import type { ReactNode } from 'react'

export function Modal({
  title,
  hint,
  children,
  onClose,
  actions
}: {
  title: string
  hint?: string
  children: ReactNode
  onClose: () => void
  actions?: ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {hint ? <p className="hint">{hint}</p> : null}
        {children}
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
