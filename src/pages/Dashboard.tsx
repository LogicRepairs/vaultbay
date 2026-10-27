import {
  HardDrive,
  Lock,
  Share2,
  Users
} from 'lucide-react'
import type { CapacityStats, ClientDevice, DiskDrive, NetworkShare } from '../shared/types'
import { formatBytes, formatRelative, platformLabel } from '../lib/format'

export function Dashboard({
  stats,
  drives,
  shares,
  clients
}: {
  stats: CapacityStats | null
  drives: DiskDrive[]
  shares: NetworkShare[]
  clients: ClientDevice[]
}) {
  const usedPct = stats && stats.totalBytes > 0 ? Math.round((stats.usedBytes / stats.totalBytes) * 100) : 0

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="grid stats">
        <div className="panel stat">
          <div className="label">Capacity</div>
          <div className="value">{stats ? formatBytes(stats.totalBytes) : '—'}</div>
          <div className="sub">{stats ? `${formatBytes(stats.freeBytes)} free · ${usedPct}% used` : 'Loading'}</div>
        </div>
        <div className="panel stat">
          <div className="label">Drives</div>
          <div className="value">{stats?.driveCount ?? '—'}</div>
          <div className="sub">
            <HardDrive size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            {stats?.encryptedCount ?? 0} encrypted
          </div>
        </div>
        <div className="panel stat">
          <div className="label">Live shares</div>
          <div className="value">{stats?.shareCount ?? '—'}</div>
          <div className="sub">
            <Share2 size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            SMB / WebDAV ready
          </div>
        </div>
        <div className="panel stat">
          <div className="label">Connected clients</div>
          <div className="value">{stats?.clientCount ?? '—'}</div>
          <div className="sub">
            <Users size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            macOS · Windows · Linux
          </div>
        </div>
      </div>

      <div className="grid two">
        <section className="panel">
          <div className="panel-head">
            <h2>Pool overview</h2>
            <span>{drives.length} attached</span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            {drives.length === 0 ? (
              <div className="empty">No spare drives detected. Plug in an external disk and rescan from Drives.</div>
            ) : (
              drives.map((drive) => {
                const used = drive.partitions.reduce((s, p) => s + p.usedBytes, 0)
                const pct = drive.sizeBytes ? Math.min(100, Math.round((used / drive.sizeBytes) * 100)) : 0
                return (
                  <div key={drive.id} className="partition-row" style={{ gridTemplateColumns: '1fr' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <strong>{drive.name}</strong>
                        <div className="row-meta">
                          <span className="chip muted">{drive.interface.toUpperCase()}</span>
                          {drive.encrypted ? (
                            <span className="chip">
                              <Lock size={12} /> Encrypted
                            </span>
                          ) : (
                            <span className="chip warn">Open</span>
                          )}
                          <span className="chip ok">{drive.mounted ? 'Mounted' : 'Offline'}</span>
                        </div>
                      </div>
                      <div className="meta">{formatBytes(used)} / {formatBytes(drive.sizeBytes)}</div>
                    </div>
                    <div className="meter" style={{ marginTop: 10 }}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Active clients</h2>
            <span>Shop LAN</span>
          </div>
          <div className="panel-body">
            {clients.length === 0 ? (
              <div className="empty">No clients connected yet.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>OS</th>
                    <th>Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <div className="meta">{c.ip}</div>
                      </td>
                      <td>{platformLabel(c.platform)}</td>
                      <td>
                        {formatRelative(c.connectedAt)}
                        <div className="meta">{formatBytes(c.bytesTransferred)} moved</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Published shares</h2>
          <span>{shares.filter((s) => s.active).length} online</span>
        </div>
        <div className="panel-body">
          {shares.length === 0 ? (
            <div className="empty">No shares published yet. Set up a drive, then create a share.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Protocol</th>
                  <th>Access</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => (
                  <tr key={share.id}>
                    <td>
                      <strong>{share.name}</strong>
                      <div className="meta">{share.description}</div>
                    </td>
                    <td>
                      <span className="chip">{share.protocol.toUpperCase()}</span>
                    </td>
                    <td>
                      {share.passwordProtected ? (
                        <span className="chip">
                          <Lock size={12} /> Password
                        </span>
                      ) : (
                        <span className="chip warn">Open</span>
                      )}
                    </td>
                    <td className="meta" style={{ fontFamily: 'var(--mono)' }}>
                      {share.connectionHint}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
