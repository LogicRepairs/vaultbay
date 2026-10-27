import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HardDrive,
  LayoutDashboard,
  Link2,
  MonitorSmartphone,
  Settings as SettingsIcon,
  Share2,
  Users
} from 'lucide-react'
import { Toast, type ToastMessage } from './components/Toast'
import { api } from './lib/api'
import { Access } from './pages/Access'
import { ClientSimple } from './pages/ClientSimple'
import { Dashboard } from './pages/Dashboard'
import { Drives } from './pages/Drives'
import { HostSimple } from './pages/HostSimple'
import { SettingsPage } from './pages/Settings'
import { Shares } from './pages/Shares'
import { UsersPage } from './pages/Users'
import type {
  AppMode,
  CapacityStats,
  ClientDevice,
  DiskDrive,
  NasSettings,
  NetworkShare,
  Platform,
  ShareUser
} from './shared/types'

type Tab = 'dashboard' | 'drives' | 'shares' | 'access' | 'users' | 'settings'

const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'drives', label: 'Drives', icon: HardDrive },
  { id: 'shares', label: 'Shares', icon: Share2 },
  { id: 'access', label: 'Access', icon: Link2 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export default function App() {
  const [mode, setMode] = useState<AppMode>('choose')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [settings, setSettings] = useState<NasSettings | null>(null)
  const [stats, setStats] = useState<CapacityStats | null>(null)
  const [drives, setDrives] = useState<DiskDrive[]>([])
  const [shares, setShares] = useState<NetworkShare[]>([])
  const [users, setUsers] = useState<ShareUser[]>([])
  const [clients, setClients] = useState<ClientDevice[]>([])
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [p, s, st, d, sh, u, c] = await Promise.all([
        api().getPlatform(),
        api().getSettings(),
        api().getStats(),
        api().listDrives(),
        api().listShares(),
        api().listUsers(),
        api().listClients()
      ])
      setPlatform(p)
      setSettings(s)
      setStats(st)
      setDrives(d)
      setShares(sh)
      setUsers(u)
      setClients(c)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load VaultBay state')
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await api().refreshDrives()
      } catch {
        // still load whatever state exists
      }
      await refresh()
    })()
  }, [refresh])

  const onToast = useCallback((title: string, detail?: string) => {
    setToast({ title, detail })
  }, [])

  const heading = useMemo(() => {
    switch (tab) {
      case 'dashboard':
        return {
          title: 'Shop storage overview',
          subtitle: 'Spare drives, encrypted vaults, and live network shares in one place.'
        }
      case 'drives':
        return {
          title: 'Drive bay',
          subtitle: 'Discover, partition, format, and encrypt spare external disks.'
        }
      case 'shares':
        return {
          title: 'Network shares',
          subtitle: 'Publish password-protected SMB endpoints for backups and transfers.'
        }
      case 'access':
        return {
          title: 'Easy access',
          subtitle: 'Map VaultBay volumes from macOS, Windows, and Linux clients.'
        }
      case 'users':
        return {
          title: 'People & passwords',
          subtitle: 'Control who can mount customer backup and job shares.'
        }
      case 'settings':
        return {
          title: 'Server settings',
          subtitle: 'Identity, discovery, updates, and encryption preferences.'
        }
    }
  }, [tab])

  if (mode === 'choose') {
    return (
      <div className="mode-screen">
        <div className="mode-brand">
          <div className="brand-mark" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" stroke="white" strokeWidth="1.6" />
              <path d="M12 12v9M12 12 4 7.5M12 12l8-4.5" stroke="white" strokeWidth="1.6" />
            </svg>
          </div>
          <div>
            <strong>VaultBay</strong>
            <span>Simple drive transfer</span>
          </div>
        </div>

        <h1>What is this computer?</h1>
        <p className="mode-copy">
          One app, two roles. Install on the shop PC that has the backup drive, and run the portable app on the
          customer PC to move files.
        </p>

        <div className="mode-cards">
          <button className="mode-card" onClick={() => setMode('host')}>
            <HardDrive size={28} />
            <strong>This PC has the drive</strong>
            <span>Shop / host — share an external backup drive for transfers</span>
          </button>
          <button className="mode-card" onClick={() => setMode('client')}>
            <MonitorSmartphone size={28} />
            <strong>Connect to the drive</strong>
            <span>Customer / portable — find the shop PC and copy files</span>
          </button>
        </div>

        <button className="btn ghost" onClick={() => setMode('advanced')}>
          Advanced tools
        </button>

        <Toast message={toast} onDone={() => setToast(null)} />
      </div>
    )
  }

  if (mode === 'host') {
    return (
      <>
        <HostSimple
          drives={drives}
          settings={settings}
          onRefresh={refresh}
          onToast={onToast}
          onBack={() => setMode('choose')}
          onAdvanced={() => setMode('advanced')}
        />
        <Toast message={toast} onDone={() => setToast(null)} />
      </>
    )
  }

  if (mode === 'client') {
    return (
      <>
        <ClientSimple
          onToast={onToast}
          onBack={() => setMode('choose')}
          onAdvanced={() => setMode('advanced')}
        />
        <Toast message={toast} onDone={() => setToast(null)} />
      </>
    )
  }

  return (
    <div className="app-shell">
      <aside className="nav">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" stroke="white" strokeWidth="1.6" />
              <path d="M12 12v9M12 12 4 7.5M12 12l8-4.5" stroke="white" strokeWidth="1.6" />
            </svg>
          </div>
          <div className="brand-copy">
            <strong>VaultBay</strong>
            <span>Advanced</span>
          </div>
        </div>

        <nav className="nav-links">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-link${tab === item.id ? ' active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="nav-footer">
          <button className="btn secondary" style={{ width: '100%' }} onClick={() => setMode('choose')}>
            Simple mode
          </button>
          <div style={{ marginTop: 8 }}>{settings?.serverName ?? 'VaultBay'}</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{heading.title}</h1>
            <p>{heading.subtitle}</p>
          </div>
        </header>

        <div className="content">
          {error ? (
            <div className="panel" style={{ padding: 24 }}>
              <strong>Couldn’t reach VaultBay services</strong>
              <p className="meta">{error}</p>
            </div>
          ) : null}

          {tab === 'dashboard' && (
            <Dashboard stats={stats} drives={drives} shares={shares} clients={clients} />
          )}
          {tab === 'drives' && <Drives drives={drives} onRefresh={refresh} onToast={onToast} />}
          {tab === 'shares' && (
            <Shares shares={shares} drives={drives} users={users} onRefresh={refresh} onToast={onToast} />
          )}
          {tab === 'access' && <Access shares={shares} onToast={onToast} />}
          {tab === 'users' && <UsersPage users={users} onRefresh={refresh} onToast={onToast} />}
          {tab === 'settings' && settings && (
            <SettingsPage
              key={settings.serverName}
              settings={settings}
              platform={platform}
              onRefresh={refresh}
              onToast={onToast}
            />
          )}
        </div>
      </main>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
