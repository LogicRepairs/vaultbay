import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import type {
  ClientDevice,
  DiskDrive,
  NasSettings,
  NetworkShare,
  ShareUser
} from '../../src/shared/types'

export interface VaultState {
  settings: NasSettings
  drives: DiskDrive[]
  shares: NetworkShare[]
  users: ShareUser[]
  clients: ClientDevice[]
  passwords: Record<string, string>
}

const defaultSettings = (): NasSettings => ({
  serverName: 'VaultBay-Shop',
  workgroup: 'WORKGROUP',
  bindAddress: '0.0.0.0',
  smbPort: 445,
  webdavPort: 8080,
  autoMountEncrypted: false,
  requireTls: true,
  allowGuest: false,
  discoveryEnabled: true,
  backupRetentionDays: 90
})

function emptyState(): VaultState {
  return {
    settings: defaultSettings(),
    drives: [],
    shares: [],
    users: [
      {
        id: uuid(),
        username: 'admin',
        displayName: 'Admin',
        role: 'admin',
        createdAt: new Date().toISOString()
      }
    ],
    clients: [],
    passwords: {}
  }
}

function migrate(raw: Record<string, unknown>): VaultState {
  const base = emptyState()
  const settingsIn = (raw.settings ?? {}) as Partial<NasSettings> & { demoMode?: boolean }
  const hadDemo = Boolean(settingsIn.demoMode)
  const { demoMode: _removed, ...settingsRest } = settingsIn

  // Drop seeded inventory. Drives are always probed live.
  // If this machine previously ran demo mode, wipe shares/clients/passwords too.
  if (hadDemo) {
    return {
      settings: { ...base.settings, ...settingsRest },
      drives: [],
      shares: [],
      users: base.users,
      clients: [],
      passwords: {}
    }
  }

  return {
    settings: { ...base.settings, ...settingsRest },
    drives: [],
    shares: Array.isArray(raw.shares) ? (raw.shares as NetworkShare[]) : [],
    users: Array.isArray(raw.users) && (raw.users as ShareUser[]).length > 0
      ? (raw.users as ShareUser[])
      : base.users,
    clients: Array.isArray(raw.clients) ? (raw.clients as ClientDevice[]) : [],
    passwords: (raw.passwords as Record<string, string>) ?? {}
  }
}

export class Store {
  private path: string
  private state: VaultState

  constructor() {
    const dir = join(app.getPath('userData'), 'vaultbay')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'state.json')
    this.state = this.load()
  }

  private load(): VaultState {
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>
        const migrated = migrate(parsed)
        this.persist(migrated)
        return migrated
      } catch {
        // fall through
      }
    }
    const state = emptyState()
    this.persist(state)
    return state
  }

  private persist(state = this.state) {
    writeFileSync(this.path, JSON.stringify(state, null, 2), 'utf8')
  }

  get(): VaultState {
    return this.state
  }

  update(mutator: (state: VaultState) => void) {
    mutator(this.state)
    this.persist()
    return this.state
  }
}
