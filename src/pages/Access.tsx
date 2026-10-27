import { useEffect, useState } from 'react'
import { Copy, Link2 } from 'lucide-react'
import { api } from '../lib/api'
import type { NetworkShare } from '../shared/types'

export function Access({
  shares,
  onToast
}: {
  shares: NetworkShare[]
  onToast: (title: string, detail?: string) => void
}) {
  const [shareId, setShareId] = useState(shares[0]?.id ?? '')
  const [guide, setGuide] = useState<{ macos: string; windows: string; linux: string; url: string } | null>(
    null
  )

  useEffect(() => {
    if (!shareId && shares[0]) setShareId(shares[0].id)
  }, [shares, shareId])

  useEffect(() => {
    if (!shareId) return
    api()
      .getAccessGuide(shareId)
      .then(setGuide)
      .catch(() => setGuide(null))
  }, [shareId])

  async function mapSelected() {
    if (!shareId) return
    const result = await api().mapDrive(shareId)
    onToast(result.message, result.detail)
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      onToast('Copied to clipboard')
    } catch {
      onToast('Copy failed')
    }
  }

  return (
    <div className="grid two">
      <section className="panel">
        <div className="panel-head">
          <h2>Client mapping</h2>
          <span>One-click path for shop & customer devices</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            Share
            <select value={shareId} onChange={(e) => setShareId(e.target.value)}>
              {shares.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {guide && (
            <>
              <div className="partition-row" style={{ gridTemplateColumns: '1fr auto' }}>
                <div>
                  <strong>Universal URL</strong>
                  <div className="meta" style={{ fontFamily: 'var(--mono)', marginTop: 6 }}>
                    {guide.url}
                  </div>
                </div>
                <button className="btn secondary" onClick={() => copy(guide.url)}>
                  <Copy size={16} /> Copy
                </button>
              </div>
              <button className="btn" onClick={mapSelected}>
                <Link2 size={16} /> Map on this host
              </button>
            </>
          )}

          <div className="checklist">
            <div className="check-item">
              <div className="n">1</div>
              <div>
                <strong>Plug spare drives into the shop host</strong>
                <div className="meta">VaultBay detects USB / Thunderbolt / SATA volumes.</div>
              </div>
            </div>
            <div className="check-item">
              <div className="n">2</div>
              <div>
                <strong>Partition, encrypt, publish</strong>
                <div className="meta">Create clean volumes and password-gated SMB shares.</div>
              </div>
            </div>
            <div className="check-item">
              <div className="n">3</div>
              <div>
                <strong>Connect from any customer device</strong>
                <div className="meta">macOS Finder, Windows Explorer, or Linux file managers.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>OS connection guides</h2>
          <span>Hand these to the bench or front desk</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
          {!guide ? (
            <div className="empty">Select a share to generate connection steps.</div>
          ) : (
            <>
              <div>
                <div className="meta" style={{ marginBottom: 6 }}>
                  macOS
                </div>
                <div className="guide-block">{guide.macos}</div>
              </div>
              <div>
                <div className="meta" style={{ marginBottom: 6 }}>
                  Windows
                </div>
                <div className="guide-block">{guide.windows}</div>
              </div>
              <div>
                <div className="meta" style={{ marginBottom: 6 }}>
                  Linux
                </div>
                <div className="guide-block">{guide.linux}</div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
