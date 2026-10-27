import { useEffect } from 'react'

export interface ToastMessage {
  title: string
  detail?: string
}

export function Toast({ message, onDone }: { message: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 4200)
    return () => clearTimeout(t)
  }, [message, onDone])

  if (!message) return null
  return (
    <div className="toast" role="status">
      <strong>{message.title}</strong>
      {message.detail ? <span>{message.detail}</span> : null}
    </div>
  )
}
