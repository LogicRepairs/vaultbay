import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { TransferProgress, UpdateStatus, VaultBayApi } from '../../src/shared/types'

const api: VaultBayApi = {
  getPlatform: () => ipcRenderer.invoke('vaultbay:getPlatform'),
  getSettings: () => ipcRenderer.invoke('vaultbay:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('vaultbay:updateSettings', patch),
  getStats: () => ipcRenderer.invoke('vaultbay:getStats'),
  listDrives: () => ipcRenderer.invoke('vaultbay:listDrives'),
  refreshDrives: () => ipcRenderer.invoke('vaultbay:refreshDrives'),
  partitionDrive: (plan) => ipcRenderer.invoke('vaultbay:partitionDrive', plan),
  encryptPartition: (partitionId, password) =>
    ipcRenderer.invoke('vaultbay:encryptPartition', partitionId, password),
  unlockPartition: (partitionId, password) =>
    ipcRenderer.invoke('vaultbay:unlockPartition', partitionId, password),
  lockPartition: (partitionId) => ipcRenderer.invoke('vaultbay:lockPartition', partitionId),
  listShares: () => ipcRenderer.invoke('vaultbay:listShares'),
  createShare: (input) => ipcRenderer.invoke('vaultbay:createShare', input),
  updateShare: (id, patch) => ipcRenderer.invoke('vaultbay:updateShare', id, patch),
  deleteShare: (id) => ipcRenderer.invoke('vaultbay:deleteShare', id),
  listUsers: () => ipcRenderer.invoke('vaultbay:listUsers'),
  createUser: (input) => ipcRenderer.invoke('vaultbay:createUser', input),
  deleteUser: (id) => ipcRenderer.invoke('vaultbay:deleteUser', id),
  listClients: () => ipcRenderer.invoke('vaultbay:listClients'),
  getAccessGuide: (shareId) => ipcRenderer.invoke('vaultbay:getAccessGuide', shareId),
  mapDrive: (shareId, mountPoint) => ipcRenderer.invoke('vaultbay:mapDrive', shareId, mountPoint),
  getUpdateStatus: () => ipcRenderer.invoke('vaultbay:getUpdateStatus'),
  checkForUpdates: () => ipcRenderer.invoke('vaultbay:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('vaultbay:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('vaultbay:installUpdate'),
  onUpdateStatus: (handler) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => handler(status)
    ipcRenderer.on('vaultbay:update-status', listener)
    return () => ipcRenderer.removeListener('vaultbay:update-status', listener)
  },
  startHostShare: (input) => ipcRenderer.invoke('vaultbay:startHostShare', input),
  stopHostShare: () => ipcRenderer.invoke('vaultbay:stopHostShare'),
  getHostSession: () => ipcRenderer.invoke('vaultbay:getHostSession'),
  startDiscovery: () => ipcRenderer.invoke('vaultbay:startDiscovery'),
  stopDiscovery: () => ipcRenderer.invoke('vaultbay:stopDiscovery'),
  listDiscoveredHosts: () => ipcRenderer.invoke('vaultbay:listDiscoveredHosts'),
  connectToHost: (input) => ipcRenderer.invoke('vaultbay:connectToHost', input),
  listRemote: (conn, path) => ipcRenderer.invoke('vaultbay:listRemote', conn, path),
  downloadRemote: (conn, remotePath) => ipcRenderer.invoke('vaultbay:downloadRemote', conn, remotePath),
  uploadToRemote: (conn, remoteFolder) =>
    ipcRenderer.invoke('vaultbay:uploadToRemote', conn, remoteFolder),
  openReleasesPage: () => ipcRenderer.invoke('vaultbay:openReleasesPage'),
  getLocalRoots: () => ipcRenderer.invoke('vaultbay:getLocalRoots'),
  listLocal: (path) => ipcRenderer.invoke('vaultbay:listLocal', path),
  pickLocalFolder: () => ipcRenderer.invoke('vaultbay:pickLocalFolder'),
  transferHostToLaptop: (conn, remotePath, localDestFolder) =>
    ipcRenderer.invoke('vaultbay:transferHostToLaptop', conn, remotePath, localDestFolder),
  transferLaptopToHost: (conn, localPath, remoteDestFolder) =>
    ipcRenderer.invoke('vaultbay:transferLaptopToHost', conn, localPath, remoteDestFolder),
  onTransferProgress: (handler) => {
    const listener = (_event: IpcRendererEvent, progress: TransferProgress) => handler(progress)
    ipcRenderer.on('vaultbay:transfer-progress', listener)
    return () => ipcRenderer.removeListener('vaultbay:transfer-progress', listener)
  },
  getSession: () => ipcRenderer.invoke('vaultbay:getSession'),
  updateSession: (patch) => ipcRenderer.invoke('vaultbay:updateSession', patch),
  saveClientPin: (pin) => ipcRenderer.invoke('vaultbay:saveClientPin', pin),
  getClientPin: () => ipcRenderer.invoke('vaultbay:getClientPin'),
  saveHostPin: (pin) => ipcRenderer.invoke('vaultbay:saveHostPin', pin),
  getHostPin: () => ipcRenderer.invoke('vaultbay:getHostPin'),
  getDataDir: () => ipcRenderer.invoke('vaultbay:getDataDir'),
  getLocalFolderStats: (path) => ipcRenderer.invoke('vaultbay:getLocalFolderStats', path),
  getRemoteFolderStats: (conn, path) => ipcRenderer.invoke('vaultbay:getRemoteFolderStats', conn, path)
}

contextBridge.exposeInMainWorld('vaultbay', api)
