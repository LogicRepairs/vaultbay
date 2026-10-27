import { useEffect, useState } from 'react'
import { Download, RefreshCw, RotateCcw } from 'lucide-react'
import { api } from '../lib/api'
import { platformLabel } from '../lib/format'
import type { NasSettings, Platform, UpdateStatus } from '../shared/types'

export function SettingsPage({
  settings,
  platform,
  onRefresh,
  onToast
}: {
  settings: NasSettings
  platform: Platform
  onRefresh: () => Promise<void>
  onToast: (title: string, detail?: string) => void
}) {
  const [form, setForm] = useState(settings)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api()
      .getUpdateStatus()
      .then(setUpdate)
      .catch(() => undefined)
    return api().onUpdateStatus(setUpdate)
  }, [])

  async function save() {
    await api().updateSettings(form)
    await onRefresh()
    onToast('Settings saved')
  }

  async function checkUpdates() {
    setBusy(true)
    try {
      const status = await api().checkForUpdates()
      setUpdate(status)
      onToast(status.message)
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setBusy(true)
    try {
      const status = await api().downloadUpdate()
      setUpdate(status)
      onToast(status.message)
    } finally {
      setBusy(false)
    }
  }

  async function install() {
    onToast('Restarting to install update…')
    await api().installUpdate()
  }

  return (
    <div className="grid two">
      <section className="panel">
        <div className="panel-head">
          <h2>Server identity</h2>
          <span>How this shop host appears on the LAN</span>
        </div>
        <div className="panel-body form-grid">
          <label className="field">
            Server name
            <input
              value={form.serverName}
              onChange={(e) => setForm({ ...form, serverName: e.target.value })}
            />
          </label>
          <label className="field">
            Workgroup
            <input value={form.workgroup} onChange={(e) => setForm({ ...form, workgroup: e.target.value })} />
          </label>
          <div className="form-grid two">
            <label className="field">
              SMB port
              <input
                type="number"
                value={form.smbPort}
                onChange={(e) => setForm({ ...form, smbPort: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              WebDAV port
              <input
                type="number"
                value={form.webdavPort}
                onChange={(e) => setForm({ ...form, webdavPort: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="field">
            Backup retention (days)
            <input
              type="number"
              value={form.backupRetentionDays}
              onChange={(e) => setForm({ ...form, backupRetentionDays: Number(e.target.value) })}
            />
          </label>
          <button className="btn" onClick={save}>
            Save settings
          </button>
        </div>
      </section>

      <div className="grid" style={{ gap: 16 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Updates</h2>
            <span>GitHub Releases · any laptop</span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            <div className="partition-row" style={{ gridTemplateColumns: '1fr' }}>
              <strong>Installed version</strong>
              <div className="meta" style={{ marginTop: 4 }}>
                {update?.currentVersion ?? '…'}
              </div>
              <div className="meta" style={{ marginTop: 8 }}>
                {update?.message ?? 'Checking update channel…'}
              </div>
              {typeof update?.percent === 'number' ? (
                <div className="meter" style={{ marginTop: 10 }}>
                  <span style={{ width: `${Math.min(100, update.percent)}%` }} />
                </div>
              ) : null}
            </div>
            <div className="meta">
              Channel:{' '}
              {update?.channel === 'portable'
                ? 'Portable build'
                : update?.channel === 'installed'
                  ? 'Installed build'
                  : 'Development'}
            </div>
            <div className="actions">
              <button className="btn secondary" disabled={busy} onClick={checkUpdates}>
                <RefreshCw size={16} /> Check for updates
              </button>
              {update?.status === 'available' ? (
                <button className="btn" disabled={busy} onClick={download}>
                  <Download size={16} /> Download update
                </button>
              ) : null}
              {update?.status === 'downloaded' ? (
                <button className="btn" onClick={install}>
                  <RotateCcw size={16} /> Restart & install
                </button>
              ) : null}
              <button className="btn ghost" onClick={() => api().openReleasesPage()}>
                Open GitHub Releases
              </button>
            </div>
            <div className="meta">
              Installed and portable builds both update from GitHub Releases. Portable apps can also just
              download the newest portable file and replace the old one.
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Security</h2>
            <span>Host: {platformLabel(platform)}</span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.requireTls}
                onChange={(e) => setForm({ ...form, requireTls: e.target.checked })}
              />
              Prefer TLS / encrypted session setup
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.allowGuest}
                onChange={(e) => setForm({ ...form, allowGuest: e.target.checked })}
              />
              Allow guest access on shares that opt in
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.discoveryEnabled}
                onChange={(e) => setForm({ ...form, discoveryEnabled: e.target.checked })}
              />
              Advertise server on local network discovery
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.autoMountEncrypted}
                onChange={(e) => setForm({ ...form, autoMountEncrypted: e.target.checked })}
              />
              Auto-prompt to unlock encrypted volumes at launch
            </label>
            <button className="btn secondary" onClick={save}>
              Apply security options
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
