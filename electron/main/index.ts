import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'path'
import type { NasSettings, PartitionPlan } from '../../src/shared/types'
import { DiskService } from './services/disk'
import { EncryptionService } from './services/encryption'
import { LocalFsService } from './services/localfs'
import { getPlatform } from './services/platform'
import { ShareService } from './services/shares'
import { DEFAULT_TRANSFER_PORT, TransferService } from './services/transfer'
import { Store } from './store'
import { registerUpdater } from './updater'
import { homedir } from 'os'

let mainWindow: BrowserWindow | null = null
const store = new Store()
const disks = new DiskService(store)
const encryption = new EncryptionService(store)
const shares = new ShareService(store)
const transfer = new TransferService()
const localfs = new LocalFsService()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 680,
    title: 'VaultBay',
    backgroundColor: '#e8eef2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function registerIpc() {
  ipcMain.handle('vaultbay:getPlatform', () => getPlatform())

  ipcMain.handle('vaultbay:getSettings', () => store.get().settings)
  ipcMain.handle('vaultbay:updateSettings', (_e, patch: Partial<NasSettings>) => {
    store.update((s) => {
      const next = { ...s.settings, ...patch } as NasSettings & { demoMode?: boolean }
      delete next.demoMode
      s.settings = next
    })
    return store.get().settings
  })

  ipcMain.handle('vaultbay:getStats', () => {
    const { drives, shares: shareList, clients } = store.get()
    const totalBytes = drives.reduce((sum, d) => sum + d.sizeBytes, 0)
    const usedBytes = drives.reduce(
      (sum, d) => sum + d.partitions.reduce((ps, p) => ps + p.usedBytes, 0),
      0
    )
    return {
      totalBytes,
      usedBytes,
      freeBytes: Math.max(totalBytes - usedBytes, 0),
      driveCount: drives.length,
      shareCount: shareList.filter((s) => s.active).length,
      clientCount: clients.length,
      encryptedCount: drives.filter((d) => d.encrypted).length
    }
  })

  ipcMain.handle('vaultbay:listDrives', () => disks.list())
  ipcMain.handle('vaultbay:refreshDrives', () => disks.refresh())
  ipcMain.handle('vaultbay:partitionDrive', (_e, plan: PartitionPlan) => disks.partition(plan))

  ipcMain.handle('vaultbay:encryptPartition', (_e, partitionId: string, password: string) =>
    encryption.encryptPartition(partitionId, password)
  )
  ipcMain.handle('vaultbay:unlockPartition', (_e, partitionId: string, password: string) =>
    encryption.unlockPartition(partitionId, password)
  )
  ipcMain.handle('vaultbay:lockPartition', (_e, partitionId: string) =>
    encryption.lockPartition(partitionId)
  )

  ipcMain.handle('vaultbay:listShares', () => shares.list())
  ipcMain.handle('vaultbay:createShare', (_e, input) => shares.createShare(input))
  ipcMain.handle('vaultbay:updateShare', (_e, id: string, patch) => shares.updateShare(id, patch))
  ipcMain.handle('vaultbay:deleteShare', (_e, id: string) => shares.deleteShare(id))

  ipcMain.handle('vaultbay:listUsers', () => shares.listUsers())
  ipcMain.handle('vaultbay:createUser', (_e, input) => shares.createUser(input))
  ipcMain.handle('vaultbay:deleteUser', (_e, id: string) => shares.deleteUser(id))

  ipcMain.handle('vaultbay:listClients', () => store.get().clients)
  ipcMain.handle('vaultbay:getAccessGuide', (_e, shareId: string) => shares.accessGuide(shareId))
  ipcMain.handle('vaultbay:mapDrive', (_e, shareId: string, mountPoint?: string) =>
    shares.mapDrive(shareId, mountPoint)
  )

  ipcMain.handle('vaultbay:startHostShare', async (_e, input: { name: string; rootPath: string; pin: string }) => {
    const settings = store.get().settings
    return transfer.startHost({
      name: input.name || settings.serverName,
      rootPath: input.rootPath,
      pin: input.pin
    })
  })
  ipcMain.handle('vaultbay:stopHostShare', () => transfer.stopHost())
  ipcMain.handle('vaultbay:getHostSession', () => transfer.getSession())
  ipcMain.handle('vaultbay:startDiscovery', () => {
    transfer.startDiscovery()
  })
  ipcMain.handle('vaultbay:stopDiscovery', () => {
    transfer.stopDiscovery()
  })
  ipcMain.handle('vaultbay:listDiscoveredHosts', () => transfer.listDiscovered())
  ipcMain.handle(
    'vaultbay:connectToHost',
    async (_e, input: { host: string; port?: number; pin: string }) => {
      const port = input.port || DEFAULT_TRANSFER_PORT
      const auth = await transfer.clientAuth(input.host, port, input.pin)
      return { host: input.host, port, token: auth.token, name: auth.name }
    }
  )
  ipcMain.handle(
    'vaultbay:listRemote',
    (_e, conn: { host: string; port: number; token: string }, path: string) =>
      transfer.clientList(conn.host, conn.port, conn.token, path)
  )
  ipcMain.handle(
    'vaultbay:downloadRemote',
    async (_e, conn: { host: string; port: number; token: string }, remotePath: string) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: basename(remotePath),
        title: 'Save file from VaultBay'
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, message: 'Download cancelled' }
      }
      return transfer.clientDownload(conn.host, conn.port, conn.token, remotePath, result.filePath)
    }
  )
  ipcMain.handle(
    'vaultbay:uploadToRemote',
    async (_e, conn: { host: string; port: number; token: string }, remoteFolder: string) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile', 'multiSelections'],
        title: 'Upload files to VaultBay host'
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, message: 'Upload cancelled' }
      }
      for (const filePath of result.filePaths) {
        await transfer.clientUpload(conn.host, conn.port, conn.token, remoteFolder, filePath)
      }
      return {
        ok: true,
        message: `Uploaded ${result.filePaths.length} file${result.filePaths.length === 1 ? '' : 's'}`
      }
    }
  )
  ipcMain.handle('vaultbay:openReleasesPage', () => {
    shell.openExternal('https://github.com/LogicRepairs/vaultbay/releases/latest')
  })

  ipcMain.handle('vaultbay:getLocalRoots', () => localfs.getRoots())
  ipcMain.handle('vaultbay:listLocal', (_e, path: string) => localfs.list(path))
  ipcMain.handle('vaultbay:pickLocalFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose a folder on this laptop',
      defaultPath: homedir()
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'vaultbay:transferHostToLaptop',
    async (
      _e,
      conn: { host: string; port: number; token: string },
      remotePath: string,
      localDestFolder: string
    ) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow
      return transfer.transferRemoteToLocal(
        conn.host,
        conn.port,
        conn.token,
        remotePath,
        localDestFolder,
        (message) => {
          if (win && !win.isDestroyed()) win.webContents.send('vaultbay:transfer-progress', message)
        }
      )
    }
  )

  ipcMain.handle(
    'vaultbay:transferLaptopToHost',
    async (
      _e,
      conn: { host: string; port: number; token: string },
      localPath: string,
      remoteDestFolder: string
    ) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow
      return transfer.transferLocalToRemote(
        conn.host,
        conn.port,
        conn.token,
        localPath,
        remoteDestFolder,
        (message) => {
          if (win && !win.isDestroyed()) win.webContents.send('vaultbay:transfer-progress', message)
        }
      )
    }
  )
}

app.whenReady().then(async () => {
  registerIpc()
  registerUpdater(() => mainWindow)
  await disks.refresh()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  transfer.stopHost().catch(() => undefined)
  transfer.stopDiscovery()
  if (process.platform !== 'darwin') app.quit()
})
