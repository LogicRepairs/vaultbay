import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../../src/shared/types'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
// Builds are not code-signed yet — Windows otherwise rejects updates.
autoUpdater.verifyUpdateCodeSignature = false
// Custom artifact names / missing blockmaps break differential downloads on Windows.
autoUpdater.disableDifferentialDownload = true
autoUpdater.allowDowngrade = false

function detectChannel(): UpdateStatus['channel'] {
  if (!app.isPackaged) return 'dev'
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  if (process.env.APPIMAGE) return 'portable'
  return 'installed'
}

function friendlyError(error: unknown, channel: UpdateStatus['channel']): string {
  const raw = error instanceof Error ? error.message : String(error || 'Update check failed')
  const lower = raw.toLowerCase()

  if (lower.includes('code signature') || lower.includes('publisher name')) {
    return 'Windows blocked the update because this build is not code-signed. Use “Open GitHub Releases” and install/replace manually.'
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('latest.yml')) {
    return 'Could not find update metadata on GitHub Releases. Open Releases and download the latest Windows build.'
  }
  if (lower.includes('enotfound') || lower.includes('network') || lower.includes('timed out')) {
    return 'Network error while checking GitHub. Check internet access and try again.'
  }
  if (channel === 'portable') {
    return `${raw} — portable apps can update by downloading the newest portable EXE from GitHub Releases.`
  }
  return raw
}

let latestStatus: UpdateStatus = {
  status: 'idle',
  currentVersion: '',
  message: 'Updates idle',
  channel: 'dev'
}

function emit(win: BrowserWindow | null, status: UpdateStatus) {
  latestStatus = { ...status, channel: status.channel || detectChannel() }
  if (win && !win.isDestroyed()) {
    win.webContents.send('vaultbay:update-status', latestStatus)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return latestStatus
}

async function checkViaGithubApi(currentVersion: string): Promise<{
  newer: boolean
  latest: string
  url: string
}> {
  const res = await fetch('https://api.github.com/repos/LogicRepairs/vaultbay/releases/latest', {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'VaultBay-Updater'
    }
  })
  if (!res.ok) throw new Error(`GitHub release check failed (${res.status})`)
  const data = (await res.json()) as { tag_name?: string; html_url?: string }
  const latest = (data.tag_name || '').replace(/^v/, '')
  const newer = Boolean(latest && latest !== currentVersion && compareSemver(latest, currentVersion) > 0)
  return {
    newer,
    latest: latest || currentVersion,
    url: data.html_url || 'https://github.com/LogicRepairs/vaultbay/releases/latest'
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

export function registerUpdater(getWindow: () => BrowserWindow | null) {
  const currentVersion = app.getVersion()
  const channel = detectChannel()

  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'LogicRepairs',
      repo: 'vaultbay'
    })
  } catch {
    // older electron-updater may already read publish config from app-update.yml
  }

  latestStatus = {
    status: 'idle',
    currentVersion,
    channel,
    message:
      channel === 'portable'
        ? `VaultBay ${currentVersion} (portable)`
        : `VaultBay ${currentVersion}`
  }

  autoUpdater.on('checking-for-update', () => {
    emit(getWindow(), {
      status: 'checking',
      currentVersion,
      channel,
      message: 'Checking GitHub Releases for updates…'
    })
  })

  autoUpdater.on('update-available', (info) => {
    emit(getWindow(), {
      status: 'available',
      currentVersion,
      availableVersion: info.version,
      channel,
      message:
        channel === 'portable'
          ? `Update ${info.version} available. Portable tip: download the new portable EXE from Releases, or try Download update.`
          : `Update ${info.version} is available`
    })
  })

  autoUpdater.on('update-not-available', () => {
    emit(getWindow(), {
      status: 'not-available',
      currentVersion,
      channel,
      message: 'You are on the latest version'
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    emit(getWindow(), {
      status: 'downloading',
      currentVersion,
      channel,
      percent: progress.percent,
      message: `Downloading update… ${progress.percent.toFixed(0)}%`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    emit(getWindow(), {
      status: 'downloaded',
      currentVersion,
      availableVersion: info.version,
      channel,
      message: `Update ${info.version} downloaded — restart to install`
    })
  })

  autoUpdater.on('error', (error) => {
    emit(getWindow(), {
      status: 'error',
      currentVersion,
      channel,
      message: friendlyError(error, channel)
    })
  })

  ipcMain.handle('vaultbay:getUpdateStatus', () => latestStatus)

  ipcMain.handle('vaultbay:checkForUpdates', async () => {
    if (!app.isPackaged) {
      const status: UpdateStatus = {
        status: 'not-available',
        currentVersion,
        channel: 'dev',
        message: 'Auto-update runs in packaged builds from GitHub Releases'
      }
      emit(getWindow(), status)
      return status
    }

    // Portable Windows: electron-updater is unreliable — use GitHub API + Releases link.
    if (channel === 'portable') {
      try {
        emit(getWindow(), {
          status: 'checking',
          currentVersion,
          channel,
          message: 'Checking GitHub Releases for updates…'
        })
        const result = await checkViaGithubApi(currentVersion)
        if (result.newer) {
          emit(getWindow(), {
            status: 'available',
            currentVersion,
            availableVersion: result.latest,
            channel,
            message: `Update ${result.latest} available. Open GitHub Releases and download the Windows portable EXE.`
          })
        } else {
          emit(getWindow(), {
            status: 'not-available',
            currentVersion,
            channel,
            message: 'You are on the latest version'
          })
        }
      } catch (error) {
        emit(getWindow(), {
          status: 'error',
          currentVersion,
          channel,
          message: friendlyError(error, channel)
        })
      }
      return latestStatus
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      // If updater returns null / no update event race, confirm via API
      if (!result && latestStatus.status === 'checking') {
        const api = await checkViaGithubApi(currentVersion)
        emit(getWindow(), {
          status: api.newer ? 'available' : 'not-available',
          currentVersion,
          availableVersion: api.newer ? api.latest : undefined,
          channel,
          message: api.newer
            ? `Update ${api.latest} is available`
            : 'You are on the latest version'
        })
      }
    } catch (error) {
      // Fallback: still tell the user if a newer GitHub release exists
      try {
        const api = await checkViaGithubApi(currentVersion)
        if (api.newer) {
          emit(getWindow(), {
            status: 'available',
            currentVersion,
            availableVersion: api.latest,
            channel,
            message: `Update ${api.latest} available. Built-in updater failed (${friendlyError(error, channel)}). Use Open GitHub Releases.`
          })
        } else {
          emit(getWindow(), {
            status: 'error',
            currentVersion,
            channel,
            message: friendlyError(error, channel)
          })
        }
      } catch {
        emit(getWindow(), {
          status: 'error',
          currentVersion,
          channel,
          message: friendlyError(error, channel)
        })
      }
    }
    return latestStatus
  })

  ipcMain.handle('vaultbay:downloadUpdate', async () => {
    if (channel === 'portable') {
      await shell.openExternal('https://github.com/LogicRepairs/vaultbay/releases/latest')
      emit(getWindow(), {
        status: 'available',
        currentVersion,
        availableVersion: latestStatus.availableVersion,
        channel,
        message: 'Opened GitHub Releases — download the Windows portable EXE and replace this file.'
      })
      return latestStatus
    }
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      emit(getWindow(), {
        status: 'error',
        currentVersion,
        channel,
        message: friendlyError(error, channel)
      })
    }
    return latestStatus
  })

  ipcMain.handle('vaultbay:installUpdate', () => {
    if (channel === 'portable') {
      shell.openExternal('https://github.com/LogicRepairs/vaultbay/releases/latest')
      return latestStatus
    }
    autoUpdater.quitAndInstall(false, true)
    return latestStatus
  })

  setTimeout(() => {
    if (app.isPackaged && channel === 'installed') {
      autoUpdater.checkForUpdates().catch(() => undefined)
    }
  }, 8_000)
}
