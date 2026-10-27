import { AlertTriangle, X } from 'lucide-react'

export function ErrorBanner({
  title,
  detail,
  onClose
}: {
  title: string
  detail?: string
  onClose?: () => void
}) {
  return (
    <div className="error-banner" role="alert">
      <AlertTriangle size={18} />
      <div>
        <strong>{title}</strong>
        {detail ? <div className="meta">{detail}</div> : null}
      </div>
      {onClose ? (
        <button className="btn ghost" onClick={onClose} aria-label="Dismiss">
          <X size={16} />
        </button>
      ) : null}
    </div>
  )
}
