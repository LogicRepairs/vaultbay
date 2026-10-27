import { safeStorage } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { v4 as uuid } from 'uuid'
import type {
  ClientDevice,
  DiskDrive,
  NasSettings,
  NetworkShare,
  SavedSession,
  ShareUser
} from '../../src/shared/types'
import { getPersistentDataDir, getSecretsFilePath, getStateFilePath, readJsonFile } from './paths'

export interface VaultState {
  settings: NasSettings
  drives: DiskDrive[]
  shares: NetworkShare[]
  users: ShareUser[]
  clients: ClientDevice[]
  passwords: Record<string, string>
  session: SavedSession
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

const defaultSession = (): SavedSession => ({
  lastMode: 'choose',
  rememberCredentials: true,
  autoReconnect: true,
  client: {
    host: '',
    port: 17890,
    localPath: '',
    lastConnectedAt: undefined
  },
  host: {
    rootPath: '',
    lastSharedAt: undefined
  }
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
    passwords: {},
    session: defaultSession()
  }
}

function migrate(raw: Record<string, unknown>): VaultState {
  const base = emptyState()
  const settingsIn = (raw.settings ?? {}) as Partial<NasSettings> & { demoMode?: boolean }
  const hadDemo = Boolean(settingsIn.demoMode)
  const { demoMode: _removed, ...settingsRest } = settingsIn
  const sessionIn = (raw.session ?? {}) as Partial<SavedSession>

  if (hadDemo) {
    return {
      ...base,
      settings: { ...base.settings, ...settingsRest }
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
    passwords: (raw.passwords as Record<string, string>) ?? {},
    session: {
      ...base.session,
      ...sessionIn,
      client: { ...base.session.client, ...(sessionIn.client || {}) },
      host: { ...base.session.host, ...(sessionIn.host || {}) }
    }
  }
}

export class Store {
  private path: string
  private secretsPath: string
  private state: VaultState
  private dataDir: string

  constructor() {
    this.dataDir = getPersistentDataDir()
    this.path = getStateFilePath()
    this.secretsPath = getSecretsFilePath()
    if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true })
    this.state = this.load()
  }

  getDataDir() {
    return this.dataDir
  }

  private load(): VaultState {
    if (existsSync(this.path)) {
      try {
        const parsed = readJsonFile<Record<string, unknown>>(this.path, {})
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

  getSession(): SavedSession {
    return this.state.session
  }

  updateSession(patch: Partial<SavedSession>) {
    this.update((s) => {
      s.session = {
        ...s.session,
        ...patch,
        client: { ...s.session.client, ...(patch.client || {}) },
        host: { ...s.session.host, ...(patch.host || {}) }
      }
    })
    return this.state.session
  }

  /** Encrypt & save PIN/passwords outside the main state file when possible */
  saveSecret(key: string, value: string) {
    const secrets = readJsonFile<Record<string, string>>(this.secretsPath, {})
    if (safeStorage.isEncryptionAvailable()) {
      secrets[key] = safeStorage.encryptString(value).toString('base64')
      secrets[`${key}__enc`] = '1'
    } else {
      secrets[key] = Buffer.from(value, 'utf8').toString('base64')
      secrets[`${key}__enc`] = '0'
    }
    writeFileSync(this.secretsPath, JSON.stringify(secrets, null, 2), 'utf8')
  }

  readSecret(key: string): string | null {
    const secrets = readJsonFile<Record<string, string>>(this.secretsPath, {})
    const raw = secrets[key]
    if (!raw) return null
    try {
      if (secrets[`${key}__enc`] === '1' && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(raw, 'base64'))
      }
      return Buffer.from(raw, 'base64').toString('utf8')
    } catch {
      return null
    }
  }

  clearSecret(key: string) {
    const secrets = readJsonFile<Record<string, string>>(this.secretsPath, {})
    delete secrets[key]
    delete secrets[`${key}__enc`]
    writeFileSync(this.secretsPath, JSON.stringify(secrets, null, 2), 'utf8')
  }
}
