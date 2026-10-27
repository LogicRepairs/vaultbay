import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '../components/Modal'
import { api } from '../lib/api'
import type { DiskDrive, NetworkShare, ShareProtocol, ShareUser } from '../shared/types'

export function Shares({
  shares,
  drives,
  users,
  onRefresh,
  onToast
}: {
  shares: NetworkShare[]
  drives: DiskDrive[]
  users: ShareUser[]
  onRefresh: () => Promise<void>
  onToast: (title: string, detail?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const partitions = drives.flatMap((d) =>
    d.partitions
      .filter((p) => p.filesystem !== 'raw' && p.encrypted !== 'locked')
      .map((p) => ({ ...p, driveName: d.name }))
  )

  const [form, setForm] = useState({
    name: '',
    partitionId: partitions[0]?.id ?? '',
    protocol: 'smb' as ShareProtocol,
    description: '',
    password: '',
    passwordProtected: true,
    guestAccess: false,
    encryptInTransit: true,
    allowedUserIds: users.filter((u) => u.role !== 'readonly').map((u) => u.id)
  })

  async function create() {
    try {
      const share = await api().createShare({
        name: form.name,
        path: '',
        partitionId: form.partitionId,
        protocol: form.protocol,
        description: form.description,
        passwordProtected: form.passwordProtected,
        guestAccess: form.guestAccess,
        allowedUserIds: form.allowedUserIds,
        encryptInTransit: form.encryptInTransit,
        password: form.password || undefined
      })
      await onRefresh()
      setOpen(false)
      onToast('Share published', share.connectionHint)
    } catch (e) {
      onToast('Could not create share', e instanceof Error ? e.message : 'Error')
    }
  }

  async function remove(id: string) {
    const result = await api().deleteShare(id)
    await onRefresh()
    onToast(result.message)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button
          className="btn"
          onClick={() => {
            setForm((f) => ({
              ...f,
              partitionId: partitions[0]?.id ?? '',
              name: '',
              description: '',
              password: ''
            }))
            setOpen(true)
          }}
        >
          <Plus size={16} /> New share
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Network shares</h2>
          <span>Map these from any customer or shop device</span>
        </div>
        <div className="panel-body">
          {shares.length === 0 ? (
            <div className="empty">No shares yet. Publish a volume to start accepting backups.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Share</th>
                  <th>Protocol</th>
                  <th>Users</th>
                  <th>Connect</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => (
                  <tr key={share.id}>
                    <td>
                      <strong>{share.name}</strong>
                      <div className="meta">{share.description || '—'}</div>
                    </td>
                    <td>
                      <span className="chip">{share.protocol.toUpperCase()}</span>
                      {share.active ? <span className="chip ok">Live</span> : null}
                    </td>
                    <td>
                      {share.allowedUserIds
                        .map((id) => users.find((u) => u.id === id)?.username)
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{share.connectionHint}</td>
                    <td>
                      <button className="btn ghost" onClick={() => remove(share.id)} title="Delete share">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {open && (
        <Modal
          title="Publish network share"
          hint="Creates an SMB/WebDAV endpoint customers and shop PCs can map as a network drive."
          onClose={() => setOpen(false)}
          actions={
            <>
              <button className="btn secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn" disabled={!form.name || !form.partitionId} onClick={create}>
                Publish
              </button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-grid two">
              <label className="field">
                Share name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="CustomerBackups"
                />
              </label>
              <label className="field">
                Protocol
                <select
                  value={form.protocol}
                  onChange={(e) => setForm({ ...form, protocol: e.target.value as ShareProtocol })}
                >
                  <option value="smb">SMB (best compatibility)</option>
                  <option value="webdav">WebDAV</option>
                  <option value="nfs">NFS</option>
                  <option value="afp">AFP</option>
                </select>
              </label>
            </div>
            <label className="field">
              Volume
              <select
                value={form.partitionId}
                onChange={(e) => setForm({ ...form, partitionId: e.target.value })}
              >
                {partitions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {p.driveName} · {p.filesystem}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Description
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Encrypted customer backup vault"
              />
            </label>
            <label className="field">
              Share password
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value, passwordProtected: true })}
                placeholder="Optional additional share secret"
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.encryptInTransit}
                onChange={(e) => setForm({ ...form, encryptInTransit: e.target.checked })}
              />
              Prefer encrypted transport where the client supports it
            </label>
          </div>
        </Modal>
      )}
    </>
  )
}
