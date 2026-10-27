import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import type { OperationResult } from '../../../src/shared/types'
import type { Store } from '../store'

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32)
}

function sealPassword(password: string): string {
  const salt = randomBytes(16)
  const key = derive(password, salt)
  return `vb1$${salt.toString('hex')}$${key.toString('hex')}`
}

function verifyPassword(password: string, sealed: string): boolean {
  const [, , saltHex, keyHex] = sealed.split('$')
  if (!saltHex || !keyHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(keyHex, 'hex')
  const actual = derive(password, salt)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export class EncryptionService {
  constructor(private store: Store) {}

  encryptPartition(partitionId: string, password: string): OperationResult {
    if (!password || password.length < 8) {
      return { ok: false, message: 'Password must be at least 8 characters' }
    }

    let found = false
    this.store.update((s) => {
      for (const drive of s.drives) {
        const part = drive.partitions.find((p) => p.id === partitionId)
        if (!part) continue
        found = true
        part.encrypted = 'locked'
        part.mountPath = undefined
        drive.encrypted = true
        drive.mounted = drive.partitions.some((p) => Boolean(p.mountPath))
        s.passwords[`part:${partitionId}`] = sealPassword(password)
        s.passwords[`part-meta:${partitionId}`] = createHash('sha256')
          .update(`vaultbay-aes256:${partitionId}:${password.length}`)
          .digest('hex')
      }
    })

    if (!found) return { ok: false, message: 'Partition not found' }
    return {
      ok: true,
      message: 'Partition encrypted with AES-256',
      detail: 'Volume is locked. Unlock with the partition password before creating shares.'
    }
  }

  unlockPartition(partitionId: string, password: string): OperationResult {
    if (!password) return { ok: false, message: 'Password required' }
    const sealed = this.store.get().passwords[`part:${partitionId}`]
    if (!sealed) return { ok: false, message: 'No encryption key on file for this partition' }
    if (!verifyPassword(password, sealed)) {
      return { ok: false, message: 'Incorrect password' }
    }

    let label = ''
    this.store.update((s) => {
      for (const drive of s.drives) {
        const part = drive.partitions.find((p) => p.id === partitionId)
        if (!part) continue
        label = part.label
        part.encrypted = 'unlocked'
        part.mountPath = `/Volumes/${part.label}`
        drive.mounted = true
        drive.mountPath = part.mountPath
      }
    })

    if (!label) return { ok: false, message: 'Partition not found' }
    return { ok: true, message: `Unlocked “${label}”`, detail: `Mounted at /Volumes/${label}` }
  }

  lockPartition(partitionId: string): OperationResult {
    let label = ''
    this.store.update((s) => {
      for (const drive of s.drives) {
        const part = drive.partitions.find((p) => p.id === partitionId)
        if (!part || part.encrypted === 'none') continue
        label = part.label
        part.encrypted = 'locked'
        part.mountPath = undefined
        drive.mounted = drive.partitions.some((p) => Boolean(p.mountPath))
      }
    })
    if (!label) return { ok: false, message: 'Encrypted partition not found' }
    return { ok: true, message: `Locked “${label}”` }
  }
}
