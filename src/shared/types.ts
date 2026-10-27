export type Platform = 'darwin' | 'linux' | 'win32' | 'unknown'

export type DriveHealth = 'healthy' | 'warning' | 'critical' | 'unknown'
export type Filesystem = 'ext4' | 'xfs' | 'apfs' | 'ntfs' | 'exfat' | 'btrfs' | 'raw'
export type ShareProtocol = 'smb' | 'afp' | 'webdav' | 'nfs'
export type EncryptionStatus = 'none' | 'locked' | 'unlocked' | 'pending'

export interface DiskDrive {
  id: string
  device: string
  name: string
  model: string
  serial: string
  sizeBytes: number
  interface: 'usb' | 'sata' | 'nvme' | 'thunderbolt' | 'unknown'
  removable: boolean
  systemDisk: boolean
  health: DriveHealth
  temperatureC?: number
  partitions: Partition[]
  encrypted: boolean
  mounted: boolean
  mountPath?: string
}

export interface Partition {
  id: string
  driveId: string
  device: string
  label: string
  sizeBytes: number
  usedBytes: number
  filesystem: Filesystem
  mountPath?: string
  encrypted: EncryptionStatus
  shareIds: string[]
}

export interface PartitionPlan {
  driveId: string
  wipe: boolean
  partitions: {
    label: string
    sizeBytes: number | 'remaining'
    filesystem: Filesystem
    encrypt: boolean
    password?: string
  }[]
}

export interface ShareUser {
  id: string
  username: string
  displayName: string
  role: 'admin' | 'readwrite' | 'readonly'
  createdAt: string
  lastSeenAt?: string
}

export interface NetworkShare {
  id: string
  name: string
  path: string
  partitionId: string
  protocol: ShareProtocol
  description: string
  passwordProtected: boolean
  guestAccess: boolean
  allowedUserIds: string[]
  encryptInTransit: boolean
  quotaBytes?: number
  createdAt: string
  active: boolean
  connectionHint: string
}

export interface ClientDevice {
  id: string
  name: string
  platform: Platform
  ip: string
  connectedAt: string
  shareIds: string[]
  bytesTransferred: number
}

export interface NasSettings {
  serverName: string
  workgroup: string
  bindAddress: string
  smbPort: number
  webdavPort: number
  autoMountEncrypted: boolean
  requireTls: boolean
  allowGuest: boolean
  discoveryEnabled: boolean
  backupRetentionDays: number
}

export interface CapacityStats {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  driveCount: number
  shareCount: number
  clientCount: number
  encryptedCount: number
}

export interface OperationResult {
  ok: boolean
  message: string
  detail?: string
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  status: UpdateState
  currentVersion: string
  availableVersion?: string
  percent?: number
  message: string
}

export interface VaultBayApi {
  getPlatform: () => Promise<Platform>
  getSettings: () => Promise<NasSettings>
  updateSettings: (patch: Partial<NasSettings>) => Promise<NasSettings>
  getStats: () => Promise<CapacityStats>
  listDrives: () => Promise<DiskDrive[]>
  refreshDrives: () => Promise<DiskDrive[]>
  partitionDrive: (plan: PartitionPlan) => Promise<OperationResult>
  encryptPartition: (partitionId: string, password: string) => Promise<OperationResult>
  unlockPartition: (partitionId: string, password: string) => Promise<OperationResult>
  lockPartition: (partitionId: string) => Promise<OperationResult>
  listShares: () => Promise<NetworkShare[]>
  createShare: (input: Omit<NetworkShare, 'id' | 'createdAt' | 'connectionHint' | 'active'> & { password?: string }) => Promise<NetworkShare>
  updateShare: (id: string, patch: Partial<NetworkShare> & { password?: string }) => Promise<NetworkShare>
  deleteShare: (id: string) => Promise<OperationResult>
  listUsers: () => Promise<ShareUser[]>
  createUser: (input: { username: string; displayName: string; password: string; role: ShareUser['role'] }) => Promise<ShareUser>
  deleteUser: (id: string) => Promise<OperationResult>
  listClients: () => Promise<ClientDevice[]>
  getAccessGuide: (shareId: string) => Promise<{ macos: string; windows: string; linux: string; url: string }>
  mapDrive: (shareId: string, mountPoint?: string) => Promise<OperationResult>
  getUpdateStatus: () => Promise<UpdateStatus>
  checkForUpdates: () => Promise<UpdateStatus>
  downloadUpdate: () => Promise<UpdateStatus>
  installUpdate: () => Promise<UpdateStatus>
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => () => void
}
