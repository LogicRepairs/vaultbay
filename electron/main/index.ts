import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import type { NasSettings, PartitionPlan } from '../../src/shared/types'
import { DiskService } from './services/disk'
import { EncryptionService } from './services/encryption'
import { getPlatform } from './services/platform'
import { ShareService } from './services/shares'
import { Store } from './store'
import { registerUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
const store = new Store()
const disks = new DiskService(store)
const encryption = new EncryptionService(store)
const shares = new ShareService(store)

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
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
  if (process.platform !== 'darwin') app.quit()
})
