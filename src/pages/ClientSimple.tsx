import { useEffect, useState } from 'react'
import { Download, FolderOpen, Link2, RefreshCw, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import type { ClientConnection, DiscoveredHost, RemoteEntry } from '../shared/types'

export function ClientSimple({
  onToast,
  onBack,
  onAdvanced
}: {
  onToast: (title: string, detail?: string) => void
  onBack: () => void
  onAdvanced: () => void
}) {
  const [hosts, setHosts] = useState<DiscoveredHost[]>([])
  const [host, setHost] = useState('')
  const [pin, setPin] = useState('')
  const [conn, setConn] = useState<ClientConnection | null>(null)
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api().startDiscovery().catch(() => undefined)
    const timer = setInterval(() => {
      api()
        .listDiscoveredHosts()
        .then(setHosts)
        .catch(() => undefined)
    }, 1500)
    return () => {
      clearInterval(timer)
      api().stopDiscovery().catch(() => undefined)
    }
  }, [])

  async function connect(selectedHost?: string) {
    const target = selectedHost || host
    if (!target || pin.length < 4) {
      onToast('Enter host and PIN')
      return
    }
    setBusy(true)
    try {
      const next = await api().connectToHost({ host: target, pin })
      setConn(next)
      setHost(target)
      setPath('.')
      const list = await api().listRemote(next, '.')
      setEntries(list)
      onToast(`Connected to ${next.name}`)
    } catch (e) {
      onToast('Connection failed', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function openFolder(nextPath: string) {
    if (!conn) return
    setBusy(true)
    try {
      const list = await api().listRemote(conn, nextPath)
      setPath(nextPath || '.')
      setEntries(list)
    } catch (e) {
      onToast('Could not open folder', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    if (!conn) return
    await openFolder(path)
  }

  async function download(entry: RemoteEntry) {
    if (!conn) return
    setBusy(true)
    try {
      const result = await api().downloadRemote(conn, entry.path)
      onToast(result.message, result.detail)
    } catch (e) {
      onToast('Download failed', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function upload() {
    if (!conn) return
    setBusy(true)
    try {
      const result = await api().uploadToRemote(conn, path)
      onToast(result.message)
      if (result.ok) await refresh()
    } catch (e) {
      onToast('Upload failed', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  function goUp() {
    if (path === '.' || !path) return
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    openFolder(parts.join('/') || '.')
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
        <div className="chip">
          <Link2 size={14} /> Customer / client PC
        </div>
        <h1>Connect to the shop drive</h1>
        <p>
          Stay on the same Wi‑Fi as the host PC. Pick the shop below (or type its IP), enter the PIN, then
          upload/download files.
        </p>
      </section>

      {!conn ? (
        <div className="grid two">
          <section className="panel">
            <div className="panel-head">
              <h2>Nearby VaultBay hosts</h2>
              <span>Auto-scanning…</span>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
              {hosts.length === 0 ? (
                <div className="empty">No host found yet. Make sure the shop PC is sharing.</div>
              ) : (
                hosts.map((h) => (
                  <button
                    key={h.id}
                    className="choice-row"
                    onClick={() => {
                      setHost(h.host)
                      connect(h.host)
                    }}
                    disabled={busy || pin.length < 4}
                  >
                    <div>
                      <strong>{h.name}</strong>
                      <div className="meta">
                        {h.host}:{h.port}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Connect</h2>
              <span>Same PIN as the host</span>
            </div>
            <div className="panel-body form-grid">
              <label className="field">
                Host IP or name
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.50"
                />
              </label>
              <label className="field">
                PIN
                <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234" />
              </label>
              <button className="btn" disabled={busy || !host || pin.length < 4} onClick={() => connect()}>
                Connect
              </button>
            </div>
          </section>
        </div>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{conn.name}</h2>
              <div className="meta">
                {conn.host} · /{path === '.' ? '' : path}
              </div>
            </div>
            <div className="actions">
              <button className="btn secondary" disabled={busy} onClick={goUp}>
                Up
              </button>
              <button className="btn secondary" disabled={busy} onClick={refresh}>
                <RefreshCw size={16} /> Refresh
              </button>
              <button className="btn" disabled={busy} onClick={upload}>
                <Upload size={16} /> Upload files
              </button>
              <button className="btn ghost" onClick={() => setConn(null)}>
                Disconnect
              </button>
            </div>
          </div>
          <div className="panel-body">
            {entries.length === 0 ? (
              <div className="empty">This folder is empty. Upload files to start the transfer.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.path}>
                      <td>
                        <strong>{entry.name}</strong>
                        <div className="meta">{entry.isDirectory ? 'Folder' : 'File'}</div>
                      </td>
                      <td>{entry.isDirectory ? '—' : formatBytes(entry.size)}</td>
                      <td>
                        {entry.isDirectory ? (
                          <button className="btn secondary" disabled={busy} onClick={() => openFolder(entry.path)}>
                            <FolderOpen size={16} /> Open
                          </button>
                        ) : (
                          <button className="btn secondary" disabled={busy} onClick={() => download(entry)}>
                            <Download size={16} /> Download
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
