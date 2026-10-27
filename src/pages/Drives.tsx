import { useMemo, useState } from 'react'
import { HardDrive, Lock, LockOpen, RefreshCw, SplitSquareVertical } from 'lucide-react'
import { Modal } from '../components/Modal'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import type { DiskDrive, Filesystem, OperationResult, PartitionPlan } from '../shared/types'

const FILESYSTEMS: Filesystem[] = ['exfat', 'apfs', 'ntfs', 'ext4', 'xfs', 'btrfs']

export function Drives({
  drives,
  onRefresh,
  onToast
}: {
  drives: DiskDrive[]
  onRefresh: () => Promise<void>
  onToast: (title: string, detail?: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [partitionDrive, setPartitionDrive] = useState<DiskDrive | null>(null)
  const [unlockPart, setUnlockPart] = useState<{ drive: DiskDrive; partitionId: string; label: string } | null>(
    null
  )
  const [encryptPart, setEncryptPart] = useState<{ partitionId: string; label: string } | null>(null)
  const [password, setPassword] = useState('')
  const [plan, setPlan] = useState<{
    label: string
    sizeGb: string
    filesystem: Filesystem
    encrypt: boolean
    password: string
  }[]>([
    { label: 'Vault', sizeGb: '', filesystem: 'exfat', encrypt: true, password: '' }
  ])

  const selected = useMemo(
    () => drives.find((d) => d.id === partitionDrive?.id) ?? null,
    [drives, partitionDrive]
  )

  async function refresh() {
    setBusy(true)
    try {
      await api().refreshDrives()
      await onRefresh()
      onToast('Drive scan complete')
    } finally {
      setBusy(false)
    }
  }

  async function applyPartition() {
    if (!selected) return
    const remainingIndex = plan.findIndex((p) => !p.sizeGb)
    const mapped: PartitionPlan['partitions'] = plan.map((p, i) => ({
      label: p.label || `Volume-${i + 1}`,
      sizeBytes: !p.sizeGb || i === remainingIndex ? 'remaining' : Math.round(Number(p.sizeGb) * 1e9),
      filesystem: p.filesystem,
      encrypt: p.encrypt,
      password: p.password || undefined
    }))

    setBusy(true)
    try {
      const result = await api().partitionDrive({
        driveId: selected.id,
        wipe: true,
        partitions: mapped
      })
      for (const p of mapped) {
        if (p.encrypt && p.password) {
          const parts = (await api().listDrives())
            .find((d) => d.id === selected.id)
            ?.partitions.find((x) => x.label === p.label)
          if (parts) await api().encryptPartition(parts.id, p.password)
        }
      }
      await onRefresh()
      setPartitionDrive(null)
      onToast(result.message, result.detail)
    } catch (e) {
      onToast('Partition failed', e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  async function doUnlock() {
    if (!unlockPart) return
    setBusy(true)
    try {
      const result: OperationResult = await api().unlockPartition(unlockPart.partitionId, password)
      await onRefresh()
      setUnlockPart(null)
      setPassword('')
      onToast(result.message, result.detail)
    } finally {
      setBusy(false)
    }
  }

  async function doEncrypt() {
    if (!encryptPart) return
    setBusy(true)
    try {
      const result = await api().encryptPartition(encryptPart.partitionId, password)
      await onRefresh()
      setEncryptPart(null)
      setPassword('')
      onToast(result.message, result.detail)
    } finally {
      setBusy(false)
    }
  }

  async function doLock(partitionId: string) {
    const result = await api().lockPartition(partitionId)
    await onRefresh()
    onToast(result.message)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn secondary" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} /> Rescan drives
        </button>
      </div>

      {drives.length === 0 ? (
        <div className="panel empty">
          No external drives found. Plug in a spare disk, then hit Rescan drives.
        </div>
      ) : null}

      <div className="grid drives">
        {drives.map((drive) => {
          const used = drive.partitions.reduce((s, p) => s + p.usedBytes, 0)
          const pct = drive.sizeBytes ? Math.min(100, Math.round((used / drive.sizeBytes) * 100)) : 0
          return (
            <article key={drive.id} className="panel drive-card">
              <div className="drive-top">
                <div>
                  <h3>{drive.name}</h3>
                  <div className="device">
                    {drive.device} · {drive.model}
                  </div>
                </div>
                <HardDrive size={22} color="var(--accent)" />
              </div>

              <div className="row-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span className="chip muted">{formatBytes(drive.sizeBytes)}</span>
                <span className="chip muted">{drive.interface}</span>
                <span className={`chip ${drive.health === 'healthy' ? 'ok' : 'warn'}`}>{drive.health}</span>
                {drive.temperatureC ? <span className="chip muted">{drive.temperatureC}°C</span> : null}
              </div>

              <div>
                <div className="meta" style={{ marginBottom: 6 }}>
                  {formatBytes(used)} used · {formatBytes(drive.sizeBytes - used)} free
                </div>
                <div className="meter">
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {drive.partitions.map((part) => (
                  <div key={part.id} className="partition-row">
                    <div>
                      <strong>{part.label}</strong>
                      <div className="row-meta">
                        <span className="chip muted">{part.filesystem}</span>
                        <span className="chip muted">{formatBytes(part.sizeBytes)}</span>
                        {part.encrypted === 'locked' && (
                          <span className="chip warn">
                            <Lock size={12} /> Locked
                          </span>
                        )}
                        {part.encrypted === 'unlocked' && (
                          <span className="chip ok">
                            <LockOpen size={12} /> Unlocked
                          </span>
                        )}
                        {part.mountPath ? <span className="chip muted">{part.mountPath}</span> : null}
                      </div>
                    </div>
                    <div className="actions" style={{ alignContent: 'start' }}>
                      {part.encrypted === 'locked' && (
                        <button
                          className="btn secondary"
                          onClick={() => {
                            setPassword('')
                            setUnlockPart({ drive, partitionId: part.id, label: part.label })
                          }}
                        >
                          Unlock
                        </button>
                      )}
                      {part.encrypted === 'unlocked' && (
                        <button className="btn ghost" onClick={() => doLock(part.id)}>
                          Lock
                        </button>
                      )}
                      {part.encrypted === 'none' && part.filesystem !== 'raw' && (
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setPassword('')
                            setEncryptPart({ partitionId: part.id, label: part.label })
                          }}
                        >
                          Encrypt
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="actions">
                <button
                  className="btn"
                  onClick={() => {
                    setPartitionDrive(drive)
                    setPlan([
                      {
                        label: 'Customer-Backups',
                        sizeGb: '',
                        filesystem: 'exfat',
                        encrypt: true,
                        password: ''
                      }
                    ])
                  }}
                  disabled={drive.systemDisk}
                >
                  <SplitSquareVertical size={16} /> Partition & format
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {partitionDrive && selected && (
        <Modal
          title={`Partition ${selected.name}`}
          hint="This will wipe existing volumes on the selected spare drive. System disks are blocked."
          onClose={() => setPartitionDrive(null)}
          actions={
            <>
              <button className="btn secondary" onClick={() => setPartitionDrive(null)}>
                Cancel
              </button>
              <button className="btn" disabled={busy} onClick={applyPartition}>
                Apply layout
              </button>
            </>
          }
        >
          <div className="form-grid">
            {plan.map((row, index) => (
              <div
                key={index}
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: '1px solid var(--line)'
                }}
              >
                <div className="form-grid two">
                  <label className="field">
                    Volume label
                    <input
                      value={row.label}
                      onChange={(e) =>
                        setPlan((prev) => prev.map((p, i) => (i === index ? { ...p, label: e.target.value } : p)))
                      }
                    />
                  </label>
                  <label className="field">
                    Size (GB, blank = remaining)
                    <input
                      value={row.sizeGb}
                      placeholder="remaining"
                      onChange={(e) =>
                        setPlan((prev) => prev.map((p, i) => (i === index ? { ...p, sizeGb: e.target.value } : p)))
                      }
                    />
                  </label>
                </div>
                <div className="form-grid two">
                  <label className="field">
                    Filesystem
                    <select
                      value={row.filesystem}
                      onChange={(e) =>
                        setPlan((prev) =>
                          prev.map((p, i) =>
                            i === index ? { ...p, filesystem: e.target.value as Filesystem } : p
                          )
                        )
                      }
                    >
                      {FILESYSTEMS.map((fs) => (
                        <option key={fs} value={fs}>
                          {fs}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Encrypt password
                    <input
                      type="password"
                      value={row.password}
                      disabled={!row.encrypt}
                      onChange={(e) =>
                        setPlan((prev) =>
                          prev.map((p, i) => (i === index ? { ...p, password: e.target.value } : p))
                        )
                      }
                      placeholder={row.encrypt ? 'Min 8 characters' : 'Encryption off'}
                    />
                  </label>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ink-soft)' }}>
                  <input
                    type="checkbox"
                    checked={row.encrypt}
                    onChange={(e) =>
                      setPlan((prev) =>
                        prev.map((p, i) => (i === index ? { ...p, encrypt: e.target.checked } : p))
                      )
                    }
                  />
                  AES-256 encryption
                </label>
              </div>
            ))}
            <button
              className="btn secondary"
              onClick={() =>
                setPlan((prev) => [
                  ...prev,
                  { label: `Volume-${prev.length + 1}`, sizeGb: '', filesystem: 'exfat', encrypt: false, password: '' }
                ])
              }
            >
              Add partition
            </button>
          </div>
        </Modal>
      )}

      {unlockPart && (
        <Modal
          title={`Unlock ${unlockPart.label}`}
          hint="Enter the volume password to mount this encrypted partition for sharing."
          onClose={() => setUnlockPart(null)}
          actions={
            <>
              <button className="btn secondary" onClick={() => setUnlockPart(null)}>
                Cancel
              </button>
              <button className="btn" disabled={busy || password.length < 1} onClick={doUnlock}>
                Unlock volume
              </button>
            </>
          }
        >
          <label className="field">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
        </Modal>
      )}

      {encryptPart && (
        <Modal
          title={`Encrypt ${encryptPart.label}`}
          hint="Applies AES-256 encryption and locks the volume until unlocked."
          onClose={() => setEncryptPart(null)}
          actions={
            <>
              <button className="btn secondary" onClick={() => setEncryptPart(null)}>
                Cancel
              </button>
              <button className="btn" disabled={busy || password.length < 8} onClick={doEncrypt}>
                Encrypt & lock
              </button>
            </>
          }
        >
          <label className="field">
            New password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
        </Modal>
      )}
    </>
  )
}
