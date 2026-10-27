import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../../src/shared/types'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let latestStatus: UpdateStatus = {
  status: 'idle',
  currentVersion: '',
  message: 'Updates idle'
}

function emit(win: BrowserWindow | null, status: UpdateStatus) {
  latestStatus = status
  if (win && !win.isDestroyed()) {
    win.webContents.send('vaultbay:update-status', status)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return latestStatus
}

export function registerUpdater(getWindow: () => BrowserWindow | null) {
  const currentVersion = app.getVersion()
  latestStatus = {
    status: 'idle',
    currentVersion,
    message: `VaultBay ${currentVersion}`
  }

  autoUpdater.on('checking-for-update', () => {
    emit(getWindow(), {
      status: 'checking',
      currentVersion,
      message: 'Checking GitHub Releases for updates…'
    })
  })

  autoUpdater.on('update-available', (info) => {
    emit(getWindow(), {
      status: 'available',
      currentVersion,
      availableVersion: info.version,
      message: `Update ${info.version} is available`
    })
  })

  autoUpdater.on('update-not-available', () => {
    emit(getWindow(), {
      status: 'not-available',
      currentVersion,
      message: 'You are on the latest version'
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    emit(getWindow(), {
      status: 'downloading',
      currentVersion,
      percent: progress.percent,
      message: `Downloading update… ${progress.percent.toFixed(0)}%`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    emit(getWindow(), {
      status: 'downloaded',
      currentVersion,
      availableVersion: info.version,
      message: `Update ${info.version} downloaded — restart to install`
    })
  })

  autoUpdater.on('error', (error) => {
    emit(getWindow(), {
      status: 'error',
      currentVersion,
      message: error.message || 'Update check failed'
    })
  })

  ipcMain.handle('vaultbay:getUpdateStatus', () => latestStatus)

  ipcMain.handle('vaultbay:checkForUpdates', async () => {
    if (!app.isPackaged) {
      const status: UpdateStatus = {
        status: 'not-available',
        currentVersion,
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
