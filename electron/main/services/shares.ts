import { v4 as uuid } from 'uuid'
import type { NetworkShare, OperationResult, ShareUser } from '../../../src/shared/types'
import type { Store } from '../store'
import { discoverHostAddresses } from './platform'

export class ShareService {
  constructor(private store: Store) {}

  list(): NetworkShare[] {
    return this.store.get().shares
  }

  listUsers(): ShareUser[] {
    return this.store.get().users
  }

  createShare(
    input: Omit<NetworkShare, 'id' | 'createdAt' | 'connectionHint' | 'active'> & { password?: string }
  ): NetworkShare {
    const settings = this.store.get().settings
    const partition = this.store
      .get()
      .drives.flatMap((d) => d.partitions)
      .find((p) => p.id === input.partitionId)

    if (!partition) throw new Error('Partition not found')
    if (partition.encrypted === 'locked') throw new Error('Unlock the encrypted partition before sharing')

    const share: NetworkShare = {
      id: uuid(),
      name: sanitizeShareName(input.name),
      path: input.path || partition.mountPath || `/vaultbay/${partition.label}`,
      partitionId: input.partitionId,
      protocol: input.protocol,
      description: input.description,
      passwordProtected: Boolean(input.passwordProtected || input.password),
      guestAccess: input.guestAccess && settings.allowGuest,
      allowedUserIds: input.allowedUserIds,
      encryptInTransit: input.encryptInTransit,
      quotaBytes: input.quotaBytes,
      createdAt: new Date().toISOString(),
      active: true,
      connectionHint: ''
    }
    share.connectionHint = buildHint(settings.serverName, share)

    this.store.update((s) => {
      s.shares.push(share)
      if (input.password) s.passwords[share.id] = input.password
      for (const drive of s.drives) {
        const part = drive.partitions.find((p) => p.id === share.partitionId)
        if (part) part.shareIds.push(share.id)
      }
    })

    return share
  }

  updateShare(id: string, patch: Partial<NetworkShare> & { password?: string }): NetworkShare {
    let updated: NetworkShare | undefined
    this.store.update((s) => {
      const share = s.shares.find((x) => x.id === id)
      if (!share) throw new Error('Share not found')
      Object.assign(share, {
        ...patch,
        id: share.id,
        createdAt: share.createdAt,
        name: patch.name ? sanitizeShareName(patch.name) : share.name
      })
      share.connectionHint = buildHint(s.settings.serverName, share)
      if (patch.password) s.passwords[id] = patch.password
      updated = share
    })
    if (!updated) throw new Error('Share not found')
    return updated
  }

  deleteShare(id: string): OperationResult {
    this.store.update((s) => {
      s.shares = s.shares.filter((x) => x.id !== id)
      delete s.passwords[id]
      for (const drive of s.drives) {
        for (const part of drive.partitions) {
          part.shareIds = part.shareIds.filter((sid) => sid !== id)
        }
      }
    })
    return { ok: true, message: 'Share removed' }
  }

  createUser(input: {
    username: string
    displayName: string
    password: string
    role: ShareUser['role']
  }): ShareUser {
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(input.username)) {
      throw new Error('Username must be 3–32 chars (letters, numbers, . _ -)')
    }
    if (this.store.get().users.some((u) => u.username === input.username)) {
      throw new Error('Username already exists')
    }
    const user: ShareUser = {
      id: uuid(),
      username: input.username,
      displayName: input.displayName || input.username,
      role: input.role,
      createdAt: new Date().toISOString()
    }
    this.store.update((s) => {
      s.users.push(user)
      s.passwords[`user:${user.id}`] = input.password
    })
    return user
  }

  deleteUser(id: string): OperationResult {
    this.store.update((s) => {
      s.users = s.users.filter((u) => u.id !== id)
      delete s.passwords[`user:${id}`]
      for (const share of s.shares) {
        share.allowedUserIds = share.allowedUserIds.filter((uid) => uid !== id)
      }
    })
    return { ok: true, message: 'User removed' }
  }

  async accessGuide(shareId: string) {
    const share = this.store.get().shares.find((s) => s.id === shareId)
    if (!share) throw new Error('Share not found')
    const settings = this.store.get().settings
    const ips = await discoverHostAddresses()
    const host = ips[0] || settings.serverName
    const unc = `\\\\${host}\\${share.name}`
    const smb = `smb://${host}/${share.name}`

    return {
      url: smb,
      macos: `Finder → Go → Connect to Server…\n${smb}\nSign in with a VaultBay user.`,
      windows: `File Explorer address bar:\n${unc}\nOr: net use Z: ${unc} /user:USERNAME`,
      linux: `Nautilus → Other Locations → Connect\n${smb}\nOr: mount -t cifs ${unc.replace(/\\/g, '/')} /mnt/${share.name} -o username=USER`
    }
  }

  async mapDrive(shareId: string, mountPoint?: string): Promise<OperationResult> {
    const share = this.store.get().shares.find((s) => s.id === shareId)
    if (!share) return { ok: false, message: 'Share not found' }
    const ips = await discoverHostAddresses()
    const host = ips[0] || this.store.get().settings.serverName
    const point = mountPoint || `/Volumes/${share.name}`

    return {
      ok: true,
      message: `Mapped ${share.name}`,
      detail: `Ready at ${point}\nSMB path: smb://${host}/${share.name}\nWindows: \\\\${host}\\${share.name}`
    }
  }
}

function sanitizeShareName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'Share'
}

function buildHint(serverName: string, share: NetworkShare): string {
  if (share.protocol === 'webdav') return `https://${serverName}:${8080}/${share.name}`
  if (share.protocol === 'nfs') return `${serverName}:/export/${share.name}`
  return `smb://${serverName}/${share.name}`
}
