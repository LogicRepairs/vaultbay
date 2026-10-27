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
import { ErrorBanner } from '../components/ErrorBanner'
import { StorageMeter } from '../components/StorageMeter'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import type {
  ClientConnection,
  DiscoveredHost,
  FolderStats,
  LocalEntry,
  LocalRoots,
  RemoteEntry,
  TransferProgress
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
  const [remember, setRemember] = useState(true)
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [conn, setConn] = useState<ClientConnection | null>(null)
  const [dataDir, setDataDir] = useState('')

  const [remotePath, setRemotePath] = useState('.')
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([])
  const [remoteSelected, setRemoteSelected] = useState<Selectable | null>(null)
  const [remoteStats, setRemoteStats] = useState<FolderStats | null>(null)

  const [roots, setRoots] = useState<LocalRoots | null>(null)
  const [localPath, setLocalPath] = useState('')
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const [localSelected, setLocalSelected] = useState<Selectable | null>(null)
  const [localStats, setLocalStats] = useState<FolderStats | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        api().startDiscovery().catch(() => undefined)
        const [session, savedPin, rootsResult, dir] = await Promise.all([
          api().getSession(),
          api().getClientPin(),
          api().getLocalRoots(),
          api().getDataDir()
        ])
        if (cancelled) return
        setRemember(session.rememberCredentials)
        setAutoReconnect(session.autoReconnect)
        setDataDir(dir)
        setRoots(rootsResult)
        if (session.client.host) setHost(session.client.host)
        if (savedPin) setPin(savedPin)
        const startLocal =
          session.client.localPath ||
          rootsResult.favorites.find((f) => f.name === 'Downloads')?.path ||
          rootsResult.home
        setLocalPath(startLocal)

        if (session.autoReconnect && session.client.host && savedPin) {
          try {
            const next = await api().connectToHost({
              host: session.client.host,
              port: session.client.port,
              pin: savedPin
            })
            if (cancelled) return
            setConn(next)
            const list = await api().listRemote(next, '.')
            setRemoteEntries(list)
            onToast('Reconnected', next.name)
          } catch (e) {
            setError({
              title: 'Could not auto-reconnect',
              detail: e instanceof Error ? e.message : 'Enter PIN and connect again'
            })
          }
        }
      } catch (e) {
        setError({
          title: 'Could not load saved settings',
          detail: e instanceof Error ? e.message : 'Starting fresh'
        })
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()

    const timer = setInterval(() => {
      api()
        .listDiscoveredHosts()
        .then(setHosts)
        .catch(() => undefined)
    }, 1500)

    const stopProgress = api().onTransferProgress(setProgress)

    return () => {
      cancelled = true
      clearInterval(timer)
      stopProgress()
      api().stopDiscovery().catch(() => undefined)
    }
  }, [onToast])

  useEffect(() => {
    if (!localPath) return
    setLocalStats(null)
    api()
      .listLocal(localPath)
      .then((entries) => {
        setLocalEntries(entries)
        setLocalSelected(null)
      })
      .catch((e) =>
        setError({
          title: 'Could not read laptop folder',
          detail: e instanceof Error ? e.message : 'Error'
        })
      )
    api()
      .getLocalFolderStats(localPath)
      .then(setLocalStats)
      .catch(() => setLocalStats(null))
  }, [localPath])

  useEffect(() => {
    if (!conn) {
      setRemoteStats(null)
      return
    }
    setRemoteStats(null)
    api()
      .getRemoteFolderStats(conn, remotePath)
      .then(setRemoteStats)
      .catch(() => setRemoteStats(null))
  }, [conn, remotePath, remoteEntries])

  const remoteLabel = useMemo(
    () => (remotePath === '.' ? '/' : `/${remotePath}`),
    [remotePath]
  )

  async function persistClient(nextHost: string, nextLocal: string, nextPin: string) {
    await api().updateSession({
      rememberCredentials: remember,
      autoReconnect,
      client: {
        host: nextHost,
        port: 17890,
        localPath: nextLocal,
        lastConnectedAt: new Date().toISOString()
      }
    })
    if (remember && nextPin) await api().saveClientPin(nextPin)
  }

  async function connect(selectedHost?: string) {
    const target = selectedHost || host
    if (!target || pin.length < 4) {
      setError({ title: 'Host and PIN required', detail: 'PIN must be at least 4 characters' })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await api().connectToHost({ host: target, pin })
      setConn(next)
      setHost(target)
      setRemotePath('.')
      setRemoteSelected(null)
      const list = await api().listRemote(next, '.')
      setRemoteEntries(list)
      await persistClient(target, localPath, pin)
      onToast(`Connected to ${next.name}`)
    } catch (e) {
      setError({
        title: 'Connection failed',
        detail: e instanceof Error ? e.message : 'Check Wi‑Fi, host sharing, and PIN'
      })
    } finally {
      setBusy(false)
    }
  }

  async function openRemote(nextPath: string) {
    if (!conn) return
    const normalized = !nextPath || nextPath === '/' ? '.' : nextPath.replace(/^\/+/, '').replace(/\\/g, '/')
    setBusy(true)
    setError(null)
    try {
      const list = await api().listRemote(conn, normalized)
      setRemotePath(normalized || '.')
      setRemoteEntries(list)
      setRemoteSelected(null)
    } catch (e) {
      setError({
        title: 'Could not open host folder',
        detail: e instanceof Error ? e.message : 'Error'
      })
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
      setLocalStats(await api().getLocalFolderStats(localPath))
    }
  }

  async function chooseLaptopFolder() {
    const picked = await api().pickLocalFolder()
    if (picked) {
      setLocalPath(picked)
      await api().updateSession({ client: { host, port: 17890, localPath: picked } })
    }
  }

  async function transferToLaptop() {
    if (!conn || !remoteSelected || !localPath) {
      setError({
        title: 'Nothing selected',
        detail: 'Select a host file/folder, and open the laptop destination folder on the right'
      })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api().transferHostToLaptop(conn, remoteSelected.path, localPath)
      onToast(result.message, result.detail)
      const entries = await api().listLocal(localPath)
      setLocalEntries(entries)
      setLocalStats(await api().getLocalFolderStats(localPath))
    } catch (e) {
      setError({
        title: 'Transfer to laptop failed',
        detail: e instanceof Error ? e.message : 'Error'
      })
    } finally {
      setBusy(false)
      setTimeout(() => setProgress(null), 1200)
    }
  }

  async function transferToHost() {
    if (!conn || !localSelected) {
      setError({
        title: 'Nothing selected',
        detail: 'Select a laptop file/folder to send into the open host folder'
      })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api().transferLaptopToHost(conn, localSelected.path, remotePath)
      onToast(result.message, result.detail)
      await openRemote(remotePath)
    } catch (e) {
      setError({
        title: 'Transfer to host failed',
        detail: e instanceof Error ? e.message : 'Error'
      })
    } finally {
      setBusy(false)
      setTimeout(() => setProgress(null), 1200)
    }
  }

  if (booting) {
    return (
      <div className="simple-shell">
        <div className="panel simple-hero fade-in">
          <div className="chip">Loading saved session…</div>
          <h1>VaultBay Client</h1>
          <p>Restoring your last host, PIN, and folders so you don’t have to set up again after an update.</p>
          <div className="meter" style={{ marginTop: 16 }}>
            <span className="meter-pulse" style={{ width: '55%' }} />
          </div>
        </div>
      </div>
    )
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

        <section className="panel simple-hero fade-in">
          <div className="chip">
            <Link2 size={14} /> Customer / client PC
          </div>
          <h1>Connect to the shop drive</h1>
          <p>
            Settings and PIN are saved under your Downloads/VaultBay-Data folder so updates don’t wipe them.
          </p>
          {dataDir ? <div className="meta">Data folder: {dataDir}</div> : null}
        </section>

        {error ? (
          <ErrorBanner title={error.title} detail={error.detail} onClose={() => setError(null)} />
        ) : null}

        <div className="grid two fade-in">
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
              <span>Saved after first success</span>
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
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember host & PIN after updates
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={autoReconnect}
                  onChange={(e) => setAutoReconnect(e.target.checked)}
                />
                Auto-reconnect on launch
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

      <section className="panel simple-hero fade-in" style={{ paddingBottom: 18 }}>
        <div className="chip ok">
          <ArrowLeftRight size={14} /> Connected to {conn.name}
        </div>
        <h1>Match folders & transfer</h1>
        <p>Select on one side, transfer into the open folder on the other. Progress and capacity show below.</p>
      </section>

      {error ? <ErrorBanner title={error.title} detail={error.detail} onClose={() => setError(null)} /> : null}

      {progress ? (
        <section className="panel progress-card fade-in">
          <div className="progress-card-top">
            <strong>{progress.message}</strong>
            <span>{progress.percent}%</span>
          </div>
          <div className="meter large">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="meta">
            {progress.filesDone}/{progress.filesTotal || '…'} files
            {progress.bytesTotal
              ? ` · ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
              : progress.bytesDone
                ? ` · ${formatBytes(progress.bytesDone)}`
                : ''}
            {progress.currentFile ? ` · ${progress.currentFile}` : ''}
          </div>
        </section>
      ) : null}

      <div className="transfer-toolbar fade-in">
        <button className="btn" disabled={busy || !remoteSelected} onClick={transferToLaptop}>
          <Download size={16} /> Download / transfer to laptop folder
        </button>
        <button className="btn secondary" disabled={busy || !localSelected} onClick={transferToHost}>
          <Upload size={16} /> Upload / transfer to host folder
        </button>
      </div>

      <div className="dual-pane fade-in">
        <section className="panel pane">
          <div className="panel-head">
            <div>
              <h2>
                <HardDrive size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
                Hosted drive
              </h2>
              <div className="meta">
                {conn.host} · {remoteLabel}
              </div>
            </div>
            <button className="btn secondary" disabled={busy} onClick={goRemoteUp}>
              <ChevronUp size={16} /> Up
            </button>
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <StorageMeter stats={remoteStats} label="Host storage" />
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
            Selected: {remoteSelected ? remoteSelected.name : 'none'} → copies into laptop folder on the right
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

          <div style={{ padding: '0 14px 8px' }}>
            <StorageMeter stats={localStats} label="Laptop storage" />
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
            Selected: {localSelected ? localSelected.name : 'none'} → copies into open host folder
          </div>
        </section>
      </div>
    </div>
  )
}
