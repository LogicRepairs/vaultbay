import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Modal } from '../components/Modal'
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
  const [pinPrompt, setPinPrompt] = useState<DiscoveredHost | null>(null)
  const [pinDraft, setPinDraft] = useState('')
  const [statusNote, setStatusNote] = useState('Looking for VaultBay hosts on your Wi‑Fi…')

  const connRef = useRef<ClientConnection | null>(null)
  const connectingRef = useRef(false)
  const pinRef = useRef('')
  const rememberRef = useRef(true)
  const autoReconnectRef = useRef(true)
  const localPathRef = useRef('')
  const preferredHostRef = useRef('')
  /** host:port keys we already handled (auto-connect or PIN prompt shown) */
  const handledHostRef = useRef<Set<string>>(new Set())
  /** host:port -> PIN that already failed, so we don't retry the same bad PIN */
  const failedPinRef = useRef<Map<string, string>>(new Map())
  const pinPromptOpenRef = useRef(false)

  useEffect(() => {
    connRef.current = conn
  }, [conn])
  useEffect(() => {
    pinRef.current = pin
  }, [pin])
  useEffect(() => {
    rememberRef.current = remember
  }, [remember])
  useEffect(() => {
    autoReconnectRef.current = autoReconnect
  }, [autoReconnect])
  useEffect(() => {
    localPathRef.current = localPath
  }, [localPath])
  useEffect(() => {
    pinPromptOpenRef.current = Boolean(pinPrompt)
  }, [pinPrompt])

  const finishConnect = useCallback(
    async (target: string, port: number, nextPin: string, label?: string) => {
      const next = await api().connectToHost({ host: target, port, pin: nextPin })
      setConn(next)
      connRef.current = next
      setHost(target)
      preferredHostRef.current = target
      setRemotePath('.')
      setRemoteSelected(null)
      setPin(nextPin)
      pinRef.current = nextPin
      setPinPrompt(null)
      pinPromptOpenRef.current = false
      setError(null)
      const list = await api().listRemote(next, '.')
      setRemoteEntries(list)
      await api().updateSession({
        rememberCredentials: rememberRef.current,
        autoReconnect: autoReconnectRef.current,
        client: {
          host: target,
          port,
          localPath: localPathRef.current,
          lastConnectedAt: new Date().toISOString()
        }
      })
      if (rememberRef.current && nextPin) await api().saveClientPin(nextPin)
      onToast(`Connected to ${label || next.name}`)
      setStatusNote(`Connected to ${label || next.name}`)
      return next
    },
    [onToast]
  )

  const connectWithPin = useCallback(
    async (target: DiscoveredHost | { host: string; port: number; name?: string }, nextPin: string) => {
      const pinValue = nextPin.trim()
      if (!target?.host || pinValue.length < 4) {
        setError({ title: 'Host and PIN required', detail: 'PIN must be at least 4 characters' })
        return false
      }
      if (connectingRef.current || connRef.current) return false

      const key = `${target.host}:${target.port || 17890}`
      connectingRef.current = true
      handledHostRef.current.add(key)
      setBusy(true)
      setError(null)
      setStatusNote(`Connecting to ${target.name || target.host}…`)
      try {
        await finishConnect(target.host, target.port || 17890, pinValue, target.name)
        failedPinRef.current.delete(key)
        return true
      } catch (e) {
        // Remember this PIN failed so discovery won't auto-retry it in a loop
        failedPinRef.current.set(key, pinValue)
        setError({
          title: `Could not connect to ${target.name || target.host}`,
          detail: e instanceof Error ? e.message : 'Check the PIN and try again'
        })
        setStatusNote(`Enter the correct PIN for ${target.name || target.host}`)
        // Keep modal open so the user can type a different PIN
        setPinPrompt({
          id: key,
          name: target.name || target.host,
          host: target.host,
          port: target.port || 17890,
          lastSeen: Date.now()
        })
        pinPromptOpenRef.current = true
        return false
      } finally {
        connectingRef.current = false
        setBusy(false)
      }
    },
    [finishConnect]
  )

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
        setAutoReconnect(session.autoReconnect !== false)
        autoReconnectRef.current = session.autoReconnect !== false
        setDataDir(dir)
        setRoots(rootsResult)
        if (session.client.host) {
          setHost(session.client.host)
          preferredHostRef.current = session.client.host
        }
        if (savedPin) {
          setPin(savedPin)
          pinRef.current = savedPin
        }
        const startLocal =
          session.client.localPath ||
          rootsResult.favorites.find((f) => f.name === 'Downloads')?.path ||
          rootsResult.home
        setLocalPath(startLocal)
        localPathRef.current = startLocal
        setStatusNote(
          savedPin
            ? 'Saved PIN loaded — will auto-connect when a VaultBay host appears'
            : 'When a host appears, you’ll be asked for the PIN (then it’s remembered)'
        )
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
    }, 1200)

    const stopProgress = api().onTransferProgress(setProgress)

    return () => {
      cancelled = true
      clearInterval(timer)
      stopProgress()
      api().stopDiscovery().catch(() => undefined)
    }
  }, [])

  // When a host is discovered: auto-connect once with saved PIN, otherwise ask for PIN once.
  useEffect(() => {
    if (booting || conn || !autoReconnect || hosts.length === 0) return
    if (connectingRef.current || pinPromptOpenRef.current) return

    const preferred = preferredHostRef.current
    const target =
      (preferred && hosts.find((h) => h.host === preferred)) || hosts[0]
    if (!target) return

    const key = `${target.host}:${target.port}`
    if (handledHostRef.current.has(key)) return

    setHost(target.host)
    const knownPin = pinRef.current.trim()
    const failedPin = failedPinRef.current.get(key)

    if (knownPin.length >= 4 && knownPin !== failedPin) {
      void connectWithPin(target, knownPin)
      return
    }

    handledHostRef.current.add(key)
    setPinPrompt(target)
    pinPromptOpenRef.current = true
    setPinDraft('')
    setStatusNote(`VaultBay host found: ${target.name} — enter PIN to connect`)
  }, [hosts, conn, autoReconnect, booting, connectWithPin])

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

  async function connect(selectedHost?: string, pinOverride?: string) {
    const targetHost = selectedHost || host
    const nextPin = (pinOverride ?? pin).trim()
    if (!targetHost || nextPin.length < 4) {
      setError({ title: 'Host and PIN required', detail: 'PIN must be at least 4 characters' })
      return
    }
    const match = hosts.find((h) => h.host === targetHost)
    // Manual connect: allow retry even if this PIN previously failed (network blip)
    const key = `${targetHost}:${match?.port || 17890}`
    failedPinRef.current.delete(key)
    await connectWithPin(
      match || { host: targetHost, port: 17890, name: targetHost },
      nextPin
    )
  }

  async function submitPinPrompt() {
    if (!pinPrompt || connectingRef.current) return
    const nextPin = pinDraft.trim()
    if (nextPin.length < 4) {
      setError({ title: 'PIN too short', detail: 'Enter the PIN shown on the shop/host PC' })
      return
    }
    // User submitted from the modal — always attempt, don't get stuck on prior failure
    failedPinRef.current.delete(`${pinPrompt.host}:${pinPrompt.port}`)
    setPin(nextPin)
    pinRef.current = nextPin
    await connectWithPin(pinPrompt, nextPin)
  }

  function dismissPinPrompt() {
    setPinPrompt(null)
    pinPromptOpenRef.current = false
    setStatusNote('PIN skipped — pick a host or enter PIN below when ready')
  }

  function disconnect() {
    setConn(null)
    connRef.current = null
    handledHostRef.current.clear()
    failedPinRef.current.clear()
    setRemoteEntries([])
    setRemoteSelected(null)
    setStatusNote('Disconnected — will reconnect when a host is found')
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
            When a VaultBay host appears on Wi‑Fi, this app connects automatically. If the PIN was saved
            before, it uses it. Otherwise it asks once, then remembers it.
          </p>
          <div className="meta" style={{ marginTop: 8 }}>
            {statusNote}
          </div>
          {dataDir ? <div className="meta">Data folder: {dataDir}</div> : null}
        </section>

        {error ? (
          <ErrorBanner title={error.title} detail={error.detail} onClose={() => setError(null)} />
        ) : null}

        <div className="grid two fade-in">
          <section className="panel">
            <div className="panel-head">
              <h2>Nearby VaultBay hosts</h2>
              <span>{hosts.length ? `${hosts.length} found` : 'Scanning…'}</span>
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
                      preferredHostRef.current = h.host
                      if (pin.trim().length >= 4) {
                        void connect(h.host)
                      } else {
                        setPinPrompt(h)
                        pinPromptOpenRef.current = true
                        setPinDraft('')
                      }
                    }}
                    disabled={busy}
                  >
                    <div>
                      <strong>{h.name}</strong>
                      <div className="meta">
                        {h.host}:{h.port}
                        {preferredHostRef.current === h.host ? ' · preferred' : ''}
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
              <span>PIN remembered after first success</span>
            </div>
            <div className="panel-body form-grid">
              <label className="field">
                Host IP or name
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
              </label>
              <label className="field">
                PIN
                <input
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value)
                    pinRef.current = e.target.value
                  }}
                  placeholder="1234"
                />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => {
                    setRemember(e.target.checked)
                    rememberRef.current = e.target.checked
                  }}
                />
                Remember host & PIN after updates
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={autoReconnect}
                  onChange={(e) => {
                    setAutoReconnect(e.target.checked)
                    autoReconnectRef.current = e.target.checked
                  }}
                />
                Auto-connect when a host is found
              </label>
              <button className="btn" disabled={busy || !host || pin.length < 4} onClick={() => connect()}>
                Connect now
              </button>
            </div>
          </section>
        </div>

        {pinPrompt ? (
          <Modal
            title={`Connect to ${pinPrompt.name}`}
            hint={`Host found at ${pinPrompt.host}. Enter the PIN from the shop/host PC. It will be remembered for next time.`}
            onClose={dismissPinPrompt}
            actions={
              <>
                <button className="btn secondary" onClick={dismissPinPrompt}>
                  Not now
                </button>
                <button
                  className="btn"
                  disabled={busy || pinDraft.trim().length < 4}
                  onClick={() => void submitPinPrompt()}
                >
                  Connect
                </button>
              </>
            }
          >
            <label className="field">
              PIN
              <input
                type="password"
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitPinPrompt()
                }}
                placeholder="Shop PIN"
                autoFocus
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  setRemember(e.target.checked)
                  rememberRef.current = e.target.checked
                }}
              />
              Remember this PIN
            </label>
          </Modal>
        ) : null}
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
          <button className="btn ghost" onClick={disconnect}>
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
