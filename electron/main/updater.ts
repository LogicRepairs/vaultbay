import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../../src/shared/types'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function detectChannel(): UpdateStatus['channel'] {
  if (!app.isPackaged) return 'dev'
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  // Linux AppImage is effectively portable
  if (process.env.APPIMAGE) return 'portable'
  return 'installed'
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

export function registerUpdater(getWindow: () => BrowserWindow | null) {
  const currentVersion = app.getVersion()
  const channel = detectChannel()
  latestStatus = {
    status: 'idle',
    currentVersion,
    channel,
    message:
      channel === 'portable'
        ? `VaultBay ${currentVersion} (portable) — updates available in Settings`
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
          ? `Update ${info.version} available — download & replace this portable app, or use Check for updates`
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
      message:
        channel === 'portable'
          ? `Update ${info.version} ready — restart to apply (or grab the new portable from Releases)`
          : `Update ${info.version} downloaded — restart to install`
    })
  })

  autoUpdater.on('error', (error) => {
    emit(getWindow(), {
      status: 'error',
      currentVersion,
      channel,
      message:
        channel === 'portable'
          ? `${error.message || 'Update check failed'} — you can also download the latest portable from GitHub Releases`
          : error.message || 'Update check failed'
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
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      emit(getWindow(), {
        status: 'error',
        currentVersion,
        channel,
        message: error instanceof Error ? error.message : 'Update check failed'
      })
    }
    return latestStatus
  })

  ipcMain.handle('vaultbay:downloadUpdate', async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      emit(getWindow(), {
        status: 'error',
        currentVersion,
        channel,
        message: error instanceof Error ? error.message : 'Download failed'
      })
    }
    return latestStatus
  })

  ipcMain.handle('vaultbay:installUpdate', () => {
    autoUpdater.quitAndInstall(false, true)
    return latestStatus
  })

  setTimeout(() => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch(() => undefined)
    }
  }, 8_000)
}
