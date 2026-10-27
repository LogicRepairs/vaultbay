import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronUp,
  Download,
  FolderOpen,
  HardDrive,
  Laptop,
  Link2,
  RefreshCw,
  Upload
} from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import type {
  ClientConnection,
  DiscoveredHost,
  LocalEntry,
  LocalRoots,
  RemoteEntry
} from '../shared/types'

type Selectable = { path: string; name: string; isDirectory: boolean }

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

  const [remotePath, setRemotePath] = useState('.')
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([])
  const [remoteSelected, setRemoteSelected] = useState<Selectable | null>(null)

  const [roots, setRoots] = useState<LocalRoots | null>(null)
  const [localPath, setLocalPath] = useState('')
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const [localSelected, setLocalSelected] = useState<Selectable | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    api().startDiscovery().catch(() => undefined)
    api()
      .getLocalRoots()
      .then((r) => {
        setRoots(r)
        setLocalPath(r.favorites.find((f) => f.name === 'Downloads')?.path || r.home)
      })
      .catch(() => undefined)

    const timer = setInterval(() => {
      api()
        .listDiscoveredHosts()
        .then(setHosts)
        .catch(() => undefined)
    }, 1500)

    const stopProgress = api().onTransferProgress(setProgress)

    return () => {
      clearInterval(timer)
      stopProgress()
      api().stopDiscovery().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!localPath) return
    api()
      .listLocal(localPath)
      .then((entries) => {
        setLocalEntries(entries)
        setLocalSelected(null)
      })
      .catch((e) => onToast('Could not read laptop folder', e instanceof Error ? e.message : 'Error'))
  }, [localPath, onToast])

  const remoteLabel = useMemo(
    () => (remotePath === '.' ? '/' : `/${remotePath}`),
    [remotePath]
  )

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
      setRemotePath('.')
      setRemoteSelected(null)
      const list = await api().listRemote(next, '.')
      setRemoteEntries(list)
      onToast(`Connected to ${next.name}`)
    } catch (e) {
      onToast('Connection failed', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function openRemote(nextPath: string) {
    if (!conn) return
    const normalized = !nextPath || nextPath === '/' ? '.' : nextPath.replace(/^\/+/, '').replace(/\\/g, '/')
    setBusy(true)
    try {
      const list = await api().listRemote(conn, normalized)
      setRemotePath(normalized || '.')
      setRemoteEntries(list)
      setRemoteSelected(null)
    } catch (e) {
      onToast('Could not open host folder', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  function goRemoteUp() {
    if (remotePath === '.' || !remotePath) return
    const parts = remotePath.split('/').filter(Boolean)
    parts.pop()
    openRemote(parts.join('/') || '.')
  }

  function goLocalUp() {
    if (!localPath || !roots) return
    const parent = localPath.replace(/[/\\]+$/, '')
    const idx = Math.max(parent.lastIndexOf('/'), parent.lastIndexOf('\\'))
    if (idx <= 0) return
    const next = parent.slice(0, idx)
    if (next.endsWith(':')) setLocalPath(next + '\\')
    else setLocalPath(next || roots.home)
  }

  async function refreshBoth() {
    if (conn) await openRemote(remotePath)
    if (localPath) {
      const entries = await api().listLocal(localPath)
      setLocalEntries(entries)
    }
  }

  async function chooseLaptopFolder() {
    const picked = await api().pickLocalFolder()
    if (picked) setLocalPath(picked)
  }

  async function transferToLaptop() {
    if (!conn || !remoteSelected || !localPath) {
      onToast('Select a host file/folder and a laptop destination folder')
      return
    }
    setBusy(true)
    setProgress('Starting transfer…')
    try {
      const result = await api().transferHostToLaptop(conn, remoteSelected.path, localPath)
      onToast(result.message, result.detail)
      const entries = await api().listLocal(localPath)
      setLocalEntries(entries)
    } catch (e) {
      onToast('Transfer to laptop failed', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function transferToHost() {
    if (!conn || !localSelected) {
      onToast('Select a laptop file/folder to send to the host')
      return
    }
    setBusy(true)
    setProgress('Starting transfer…')
    try {
      const result = await api().transferLaptopToHost(conn, localSelected.path, remotePath)
      onToast(result.message, result.detail)
      await openRemote(remotePath)
    } catch (e) {
      onToast('Transfer to host failed', e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  if (!conn) {
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
            Join the same Wi‑Fi as the host, enter the PIN, then use the dual-pane browser to move whole
            folders between the shop drive and this laptop.
          </p>
        </section>

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
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
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
      </div>
    )
  }

  return (
    <div className="simple-shell">
      <div className="simple-top">
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
        <div className="actions">
          <button className="btn secondary" disabled={busy} onClick={refreshBoth}>
            <RefreshCw size={16} /> Refresh both
          </button>
          <button className="btn ghost" onClick={() => setConn(null)}>
            Disconnect
          </button>
          <button className="btn ghost" onClick={onAdvanced}>
            Advanced tools
          </button>
        </div>
      </div>

      <section className="panel simple-hero" style={{ paddingBottom: 18 }}>
        <div className="chip ok">
          <ArrowLeftRight size={14} /> Connected to {conn.name}
        </div>
        <h1>Match folders & transfer</h1>
        <p>
          Left = shop/host drive. Right = this laptop. Select an item, then transfer into the folder open on
          the other side.
        </p>
        {progress ? <div className="meta" style={{ marginTop: 10 }}>{progress}</div> : null}
      </section>

      <div className="transfer-toolbar">
        <button className="btn" disabled={busy || !remoteSelected} onClick={transferToLaptop}>
          <Download size={16} /> Download / transfer to laptop folder
        </button>
        <button className="btn secondary" disabled={busy || !localSelected} onClick={transferToHost}>
          <Upload size={16} /> Upload / transfer to host folder
        </button>
      </div>

      <div className="dual-pane">
        <section className="panel pane">
          <div className="panel-head">
            <div>
              <h2>
                <HardDrive size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
                Hosted drive
              </h2>
              <div className="meta">{conn.host} · {remoteLabel}</div>
            </div>
            <div className="actions">
              <button className="btn secondary" disabled={busy} onClick={goRemoteUp}>
                <ChevronUp size={16} /> Up
              </button>
            </div>
          </div>
          <div className="pane-body">
            {remoteEntries.length === 0 ? (
              <div className="empty">This host folder is empty.</div>
            ) : (
              remoteEntries.map((entry) => {
                const selected = remoteSelected?.path === entry.path
                return (
                  <div
                    key={entry.path}
                    className={`file-row${selected ? ' selected' : ''}`}
                    onClick={() =>
                      setRemoteSelected({
                        path: entry.path,
                        name: entry.name,
                        isDirectory: entry.isDirectory
                      })
                    }
                    onDoubleClick={() => {
                      if (entry.isDirectory) openRemote(entry.path)
                    }}
                  >
                    <div>
                      <strong>{entry.name}</strong>
                      <div className="meta">
                        {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
                        {selected ? ' · selected' : ''}
                      </div>
                    </div>
                    {entry.isDirectory ? (
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation()
                          openRemote(entry.path)
                        }}
                      >
                        <FolderOpen size={14} /> Open
                      </button>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
          <div className="pane-footer meta">
            Selected host item: {remoteSelected ? remoteSelected.name : 'none'} → copies into laptop folder
            below/right
          </div>
        </section>

        <section className="panel pane">
          <div className="panel-head">
            <div>
              <h2>
                <Laptop size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
                This laptop
              </h2>
              <div className="meta" style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
                {localPath || '…'}
              </div>
            </div>
            <div className="actions">
              <button className="btn secondary" disabled={busy} onClick={goLocalUp}>
                <ChevronUp size={16} /> Up
              </button>
              <button className="btn secondary" disabled={busy} onClick={chooseLaptopFolder}>
                Choose folder
              </button>
            </div>
          </div>

          {roots && (
            <div className="fav-row">
              {roots.favorites.map((f) => (
                <button key={f.path} className="chip muted" onClick={() => setLocalPath(f.path)}>
                  {f.name}
                </button>
              ))}
              {roots.drives.slice(0, 6).map((d) => (
                <button key={d.path} className="chip muted" onClick={() => setLocalPath(d.path)}>
                  {d.name}
                </button>
              ))}
            </div>
          )}

          <div className="pane-body">
            {localEntries.length === 0 ? (
              <div className="empty">This laptop folder is empty.</div>
            ) : (
              localEntries.map((entry) => {
                const selected = localSelected?.path === entry.path
                return (
                  <div
                    key={entry.path}
                    className={`file-row${selected ? ' selected' : ''}`}
                    onClick={() =>
                      setLocalSelected({
                        path: entry.path,
                        name: entry.name,
                        isDirectory: entry.isDirectory
                      })
                    }
                    onDoubleClick={() => {
                      if (entry.isDirectory) setLocalPath(entry.path)
                    }}
                  >
                    <div>
                      <strong>{entry.name}</strong>
                      <div className="meta">
                        {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
                        {selected ? ' · selected' : ''}
                      </div>
                    </div>
                    {entry.isDirectory ? (
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation()
                          setLocalPath(entry.path)
                        }}
                      >
                        <FolderOpen size={14} /> Open
                      </button>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
          <div className="pane-footer meta">
            Selected laptop item: {localSelected ? localSelected.name : 'none'} → copies into open host folder
          </div>
        </section>
      </div>
    </div>
  )
}
