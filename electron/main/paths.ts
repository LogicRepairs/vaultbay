import { app } from 'electron'
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Persistent data lives outside the app install so updates never wipe it.
 * Priority:
 * 1) Portable sidecar folder next to the EXE (survives replacing the portable file)
 * 2) Downloads/VaultBay-Data (easy to find / backup on customer laptops)
 * 3) Electron userData (installed builds)
 */
export function getPersistentDataDir(): string {
  const portableRoot =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    process.env.PORTABLE_EXECUTABLE_FILE?.replace(/[\\/][^\\/]+$/, '') ||
    (process.env.APPIMAGE ? join(homedir(), 'VaultBay-Data') : null)

  if (portableRoot) {
    const dir = join(portableRoot, 'VaultBay-Data')
    ensureDir(dir)
    return dir
  }

  const downloads = join(app.getPath('downloads'), 'VaultBay-Data')
  ensureDir(downloads)

  // Keep a mirror in userData for installed builds, but prefer Downloads as canonical
  const userData = join(app.getPath('userData'), 'vaultbay')
  ensureDir(userData)

  // One-time migrate old userData state into Downloads if needed
  const oldState = join(userData, 'state.json')
  const newState = join(downloads, 'state.json')
  if (existsSync(oldState) && !existsSync(newState)) {
    try {
      copyFileSync(oldState, newState)
    } catch {
      // ignore
    }
  }

  return downloads
}

export function getStateFilePath(): string {
  return join(getPersistentDataDir(), 'state.json')
}

export function getSecretsFilePath(): string {
  return join(getPersistentDataDir(), 'secrets.json')
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}
