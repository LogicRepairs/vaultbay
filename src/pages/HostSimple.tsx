import { useEffect, useMemo, useState } from 'react'
import { HardDrive, Radio, StopCircle } from 'lucide-react'
import { ErrorBanner } from '../components/ErrorBanner'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import type { DiskDrive, HostSession, NasSettings } from '../shared/types'

export function HostSimple({
  drives,
  settings,
  onRefresh,
  onToast,
  onBack,
  onAdvanced
}: {
  drives: DiskDrive[]
  settings: NasSettings | null
  onRefresh: () => Promise<void>
  onToast: (title: string, detail?: string) => void
  onBack: () => void
  onAdvanced: () => void
}) {
  const mounts = useMemo(
    () =>
      drives.flatMap((d) =>
        d.partitions
          .filter((p) => p.mountPath && p.encrypted !== 'locked' && p.filesystem !== 'raw')
          .map((p) => ({
            id: p.id,
            label: p.label,
            path: p.mountPath!,
            driveName: d.name,
            size: p.sizeBytes
          }))
      ),
    [drives]
  )

  const [rootPath, setRootPath] = useState(mounts[0]?.path || '')
  const [pin, setPin] = useState('1234')
  const [session, setSession] = useState<HostSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null)
  const [dataDir, setDataDir] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [live, saved, savedPin, dir] = await Promise.all([
          api().getHostSession(),
          api().getSession(),
          api().getHostPin(),
          api().getDataDir()
        ])
        setDataDir(dir)
        if (live) {
          setSession(live)
          if (live.rootPath) setRootPath(live.rootPath)
          if (live.pin) setPin(live.pin)
        } else {
          if (saved.host.rootPath) setRootPath(saved.host.rootPath)
          if (savedPin) setPin(savedPin)
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  useEffect(() => {
    if (!rootPath && mounts[0]) setRootPath(mounts[0].path)
  }, [mounts, rootPath])

  async function start() {
    setBusy(true)
    setError(null)
    try {
      await onRefresh()
      const next = await api().startHostShare({
        name: settings?.serverName || 'VaultBay-Shop',
        rootPath,
        pin
      })
      setSession(next)
      await api().saveHostPin(pin)
      await api().updateSession({
        host: { rootPath, lastSharedAt: new Date().toISOString() }
      })
      onToast('Sharing started', next.shareHint)
    } catch (e) {
      setError({
        title: 'Could not start sharing',
        detail: e instanceof Error ? e.message : 'Check the drive is mounted and try again'
      })
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      const result = await api().stopHostShare()
      setSession(null)
      onToast(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="simple-shell">
      <div className="simple-top">
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="btn ghost" onClick={onAdvanced}>
          Advanced tools
        </button>
      </div>

      <section className="panel simple-hero">
        <div className="chip ok">
          <HardDrive size={14} /> Host PC
        </div>
        <h1>Share this backup drive</h1>
        <p>
          Plug in the external drive, pick it below, set a short PIN, then start sharing. On the customer PC,
          open the portable VaultBay app and choose <strong>Connect</strong>.
        </p>
        {dataDir ? <div className="meta">Saved settings folder: {dataDir}</div> : null}
      </section>

      {error ? <ErrorBanner title={error.title} detail={error.detail} onClose={() => setError(null)} /> : null}

      <div className="grid two fade-in">
        <section className="panel">
          <div className="panel-head">
            <h2>1. Choose drive folder</h2>
            <button className="btn secondary" onClick={() => onRefresh()}>
              Rescan
            </button>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
            {mounts.length === 0 ? (
              <div className="empty">No mounted spare drives found. Plug one in and rescan.</div>
            ) : (
              mounts.map((m) => (
                <label key={m.id} className={`choice-row${rootPath === m.path ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="root"
                    checked={rootPath === m.path}
                    onChange={() => setRootPath(m.path)}
                  />
                  <div>
                    <strong>{m.label}</strong>
                    <div className="meta">
                      {m.driveName} · {formatBytes(m.size)}
                    </div>
                    <div className="meta" style={{ fontFamily: 'var(--mono)' }}>
                      {m.path}
                    </div>
                  </div>
                </label>
              ))
            )}
            <label className="field">
              Or type a folder path
              <input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="/Volumes/Backups" />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>2. Set PIN & start</h2>
            <span>Customers need this PIN</span>
          </div>
          <div className="panel-body form-grid">
            <label className="field">
              Access PIN
              <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234" />
            </label>
            {session?.running ? (
              <>
                <div className="partition-row" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="chip ok">
                    <Radio size={14} /> Sharing now
                  </div>
                  <strong style={{ marginTop: 8 }}>{session.name}</strong>
                  <div className="meta" style={{ marginTop: 6 }}>
                    {session.shareHint}
                  </div>
                  {session.addresses.map((ip) => (
                    <div key={ip} className="guide-block" style={{ marginTop: 8 }}>
                      {ip}
                    </div>
                  ))}
                  <div className="meta" style={{ marginTop: 8 }}>
                    PIN: <strong>{session.pin}</strong>
                  </div>
                </div>
                <button className="btn danger" disabled={busy} onClick={stop}>
                  <StopCircle size={16} /> Stop sharing
                </button>
              </>
            ) : (
              <button className="btn" disabled={busy || !rootPath || pin.length < 4} onClick={start}>
                <Radio size={16} /> Start sharing
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
