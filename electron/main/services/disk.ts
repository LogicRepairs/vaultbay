import { createHash } from 'crypto'
import type { DiskDrive, Filesystem, OperationResult, Partition, PartitionPlan } from '../../../src/shared/types'
import type { Store } from '../store'
import { getPlatform, runCommand } from './platform'

function stableId(parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

function bytesFromHuman(size: string): number {
  const match = size.trim().match(/^([\d.]+)\s*([KMGTP]?i?B?)$/i)
  if (!match) return 0
  const n = Number(match[1])
  const unit = (match[2] || 'B').toUpperCase()
  const map: Record<string, number> = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4
  }
  return Math.round(n * (map[unit] ?? 1))
}

function guessFs(text: string): Filesystem {
  const type = text.toLowerCase()
  if (type.includes('apfs')) return 'apfs'
  if (type.includes('exfat')) return 'exfat'
  if (type.includes('ntfs')) return 'ntfs'
  if (type.includes('ext4') || type.includes('ext3') || type.includes('ext2')) return 'ext4'
  if (type.includes('xfs')) return 'xfs'
  if (type.includes('btrfs')) return 'btrfs'
  if (type.includes('fat')) return 'exfat'
  return 'raw'
}

function mapInterface(protocol: string, solid = false): DiskDrive['interface'] {
  const p = protocol.toLowerCase()
  if (p.includes('thunderbolt')) return 'thunderbolt'
  if (p.includes('usb')) return 'usb'
  if (p.includes('nvme') || solid) return 'nvme'
  if (p.includes('sata') || p.includes('ata')) return 'sata'
  return 'unknown'
}

async function probeDarwin(): Promise<DiskDrive[]> {
  const info = await runCommand('diskutil', ['list'])
  if (!info.ok) return []

  const disks: DiskDrive[] = []
  const blocks = info.stdout.split(/\n(?=\/dev\/disk)/)

  for (const block of blocks) {
    const deviceMatch = block.match(/^(\/dev\/disk\d+)/)
    if (!deviceMatch) continue
    const device = deviceMatch[1]

    const detail = await runCommand('diskutil', ['info', device])
    if (!detail.ok) continue

    const internal = /Internal:\s+Yes/i.test(detail.stdout)
    const system = /System:\s+Yes/i.test(detail.stdout) || device === '/dev/disk0'
    const virtual = /Virtual:\s+Yes/i.test(detail.stdout)
    if (system || virtual) continue

    const name =
      detail.stdout.match(/Device \/ Media Name:\s+(.+)/)?.[1]?.trim() ||
      detail.stdout.match(/Volume Name:\s+(.+)/)?.[1]?.trim() ||
      device
    const sizeLine = detail.stdout.match(/Disk Size:\s+.+?\((\d+) Bytes\)/)
    const sizeBytes = sizeLine ? Number(sizeLine[1]) : 0
    const protocol = detail.stdout.match(/Protocol:\s+(.+)/)?.[1] || 'unknown'
    const removable = /Removable Media:\s+Removable/i.test(detail.stdout)
    const solid = /Solid State:\s+Yes/i.test(detail.stdout)
    const serial =
      detail.stdout.match(/Device Identifier:\s+(.+)/)?.[1]?.trim() ||
      detail.stdout.match(/Disk \/ Partition UUID:\s+(.+)/)?.[1]?.trim() ||
      device

    // Prefer external / removable spare drives; still allow non-internal disks.
    if (internal && !removable) continue

    const driveId = stableId(['darwin', device, serial])
    const partitions: Partition[] = []
    const volumeLines = block.split('\n').slice(1)

    for (const line of volumeLines) {
      const partMatch = line.match(/^\s+\d+:\s+\S+\s+(\S+)\s+([\d.]+\s+\w+)\s+(disk\d+s\d+)/)
      if (!partMatch) continue
      const label = partMatch[1] === 'Untitled' || partMatch[1] === '*' ? 'Untitled' : partMatch[1]
      const partDevice = `/dev/${partMatch[3]}`
      const partSize = bytesFromHuman(partMatch[2])
      const partInfo = await runCommand('diskutil', ['info', partDevice])
      const mountPath = partInfo.stdout.match(/Mount Point:\s+(.+)/)?.[1]?.trim()
      const fsText =
        partInfo.stdout.match(/File System Personality:\s+(.+)/)?.[1] ||
        partInfo.stdout.match(/Type \(Bundle\):\s+(.+)/)?.[1] ||
        ''
      const encrypted = /Encrypted:\s+Yes/i.test(partInfo.stdout)
        ? mountPath
          ? 'unlocked'
          : 'locked'
        : 'none'

      partitions.push({
        id: stableId(['darwin-part', partDevice, label]),
        driveId,
        device: partDevice,
        label: mountPath && mountPath !== 'Not applicable' ? label : label,
        sizeBytes: partSize,
        usedBytes: 0,
        filesystem: guessFs(fsText),
        mountPath: mountPath && mountPath !== 'Not applicable' ? mountPath : undefined,
        encrypted,
        shareIds: []
      })
    }

    if (partitions.length === 0) {
      partitions.push({
        id: stableId(['darwin-part', device, 'raw']),
        driveId,
        device,
        label: 'Unallocated',
        sizeBytes,
        usedBytes: 0,
        filesystem: 'raw',
        encrypted: 'none',
        shareIds: []
      })
    }

    disks.push({
      id: driveId,
      device,
      name,
      model: name,
      serial,
      sizeBytes,
      interface: mapInterface(protocol, solid),
      removable,
      systemDisk: false,
      health: 'healthy',
      partitions,
      encrypted: partitions.some((p) => p.encrypted !== 'none'),
      mounted: partitions.some((p) => Boolean(p.mountPath)),
      mountPath: partitions.find((p) => p.mountPath)?.mountPath
    })
  }

  return disks
}

async function probeLinux(): Promise<DiskDrive[]> {
  const result = await runCommand('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,FSTYPE,LABEL,MOUNTPOINT,MODEL,SERIAL,TRAN,RM,ROTA'])
  if (!result.ok) return []

  try {
    const parsed = JSON.parse(result.stdout) as {
      blockdevices?: Array<{
        name: string
        path?: string
        size?: string | number
        type?: string
        fstype?: string | null
        label?: string | null
        mountpoint?: string | null
        model?: string | null
        serial?: string | null
        tran?: string | null
        rm?: boolean | string | number
        children?: Array<{
          name: string
          path?: string
          size?: string | number
          type?: string
          fstype?: string | null
          label?: string | null
          mountpoint?: string | null
        }>
      }>
    }

    const disks: DiskDrive[] = []
    for (const disk of parsed.blockdevices ?? []) {
      if (disk.type !== 'disk') continue
      const device = disk.path || `/dev/${disk.name}`
      if (device === '/dev/sda' && disk.mountpoint === '/') continue
      const hasRoot = (disk.children ?? []).some((c) => c.mountpoint === '/' || c.mountpoint === '/boot')
      if (hasRoot) continue

      const serial = disk.serial || disk.name
      const driveId = stableId(['linux', device, serial])
      const sizeBytes = Number(disk.size || 0)
      const children = disk.children ?? []
      const partitions: Partition[] =
        children.length > 0
          ? children
              .filter((c) => c.type === 'part')
              .map((c) => ({
                id: stableId(['linux-part', c.path || c.name, c.label || '']),
                driveId,
                device: c.path || `/dev/${c.name}`,
                label: c.label || c.name,
                sizeBytes: Number(c.size || 0),
                usedBytes: 0,
                filesystem: guessFs(c.fstype || 'raw'),
                mountPath: c.mountpoint || undefined,
                encrypted: (c.fstype || '').includes('crypto') ? (c.mountpoint ? 'unlocked' : 'locked') : 'none',
                shareIds: []
              }))
          : [
              {
                id: stableId(['linux-part', device, 'raw']),
                driveId,
                device,
                label: 'Unallocated',
                sizeBytes,
                usedBytes: 0,
                filesystem: 'raw' as Filesystem,
                encrypted: 'none' as const,
                shareIds: []
              }
            ]

      disks.push({
        id: driveId,
        device,
        name: disk.model?.trim() || disk.name,
        model: disk.model?.trim() || disk.name,
        serial,
        sizeBytes,
        interface: mapInterface(disk.tran || ''),
        removable: disk.rm === true || disk.rm === 1 || disk.rm === '1',
        systemDisk: false,
        health: 'healthy',
        partitions,
        encrypted: partitions.some((p) => p.encrypted !== 'none'),
        mounted: partitions.some((p) => Boolean(p.mountPath)),
        mountPath: partitions.find((p) => p.mountPath)?.mountPath
      })
    }
    return disks
  } catch {
    return []
  }
}

async function probeWindows(): Promise<DiskDrive[]> {
  const result = await runCommand('powershell', [
    '-NoProfile',
    '-Command',
    `Get-Disk | Select-Object Number,FriendlyName,SerialNumber,Size,BusType,PartitionStyle,IsSystem,IsBoot,OperationalStatus | ConvertTo-Json -Compress`
  ])
  if (!result.ok || !result.stdout.trim()) return []

  try {
    const raw = JSON.parse(result.stdout) as Array<Record<string, unknown>> | Record<string, unknown>
    const rows = Array.isArray(raw) ? raw : [raw]
    const disks: DiskDrive[] = []

    for (const row of rows) {
      if (row.IsSystem || row.IsBoot) continue
      const number = String(row.Number ?? '')
      const device = `\\\\.\\PhysicalDrive${number}`
      const serial = String(row.SerialNumber ?? number)
      const driveId = stableId(['win', device, serial])
      const sizeBytes = Number(row.Size ?? 0)

      const partResult = await runCommand('powershell', [
        '-NoProfile',
        '-Command',
        `Get-Partition -DiskNumber ${number} | Select-Object PartitionNumber,Size,DriveLetter,Type | ConvertTo-Json -Compress`
      ])

      let partitions: Partition[] = []
      if (partResult.ok && partResult.stdout.trim()) {
        try {
          const partRaw = JSON.parse(partResult.stdout) as Array<Record<string, unknown>> | Record<string, unknown>
          const partRows = Array.isArray(partRaw) ? partRaw : [partRaw]
          partitions = partRows.map((p) => {
            const letter = p.DriveLetter ? `${p.DriveLetter}:` : undefined
            return {
              id: stableId(['win-part', number, String(p.PartitionNumber ?? '')]),
              driveId,
              device: letter || `${device}-p${p.PartitionNumber}`,
              label: letter || `Partition ${p.PartitionNumber}`,
              sizeBytes: Number(p.Size ?? 0),
              usedBytes: 0,
              filesystem: 'ntfs' as Filesystem,
              mountPath: letter,
              encrypted: 'none' as const,
              shareIds: []
            }
          })
        } catch {
          partitions = []
        }
      }

      if (partitions.length === 0) {
        partitions = [
          {
            id: stableId(['win-part', number, 'raw']),
            driveId,
            device,
            label: 'Unallocated',
            sizeBytes,
            usedBytes: 0,
            filesystem: 'raw',
            encrypted: 'none',
            shareIds: []
          }
        ]
      }

      disks.push({
        id: driveId,
        device,
        name: String(row.FriendlyName ?? `Disk ${number}`),
        model: String(row.FriendlyName ?? `Disk ${number}`),
        serial,
        sizeBytes,
        interface: mapInterface(String(row.BusType ?? '')),
        removable: String(row.BusType ?? '').toLowerCase().includes('usb'),
        systemDisk: false,
        health: String(row.OperationalStatus ?? 'unknown').toLowerCase() === 'online' ? 'healthy' : 'unknown',
        partitions,
        encrypted: false,
        mounted: partitions.some((p) => Boolean(p.mountPath)),
        mountPath: partitions.find((p) => p.mountPath)?.mountPath
      })
    }
    return disks
  } catch {
    return []
  }
}

export class DiskService {
  constructor(private store: Store) {}

  list(): DiskDrive[] {
    return this.store.get().drives
  }

  async refresh(): Promise<DiskDrive[]> {
    const platform = getPlatform()
    let probed: DiskDrive[] = []
    if (platform === 'darwin') probed = await probeDarwin()
    else if (platform === 'linux') probed = await probeLinux()
    else if (platform === 'win32') probed = await probeWindows()

    this.store.update((s) => {
      const previous = s.drives
      s.drives = probed.map((drive) => {
        const prior = previous.find((p) => p.serial === drive.serial || p.device === drive.device)
        if (!prior) return drive
        drive.partitions = drive.partitions.map((part) => {
          const priorPart = prior.partitions.find(
            (pp) => pp.device === part.device || pp.label === part.label
          )
          return priorPart
            ? {
                ...part,
                id: priorPart.id,
                shareIds: priorPart.shareIds,
                encrypted: priorPart.encrypted !== 'none' ? priorPart.encrypted : part.encrypted,
                mountPath: part.mountPath || priorPart.mountPath
              }
            : part
        })
        drive.id = prior.id
        drive.encrypted = drive.partitions.some((p) => p.encrypted !== 'none')
        return drive
      })

      // Drop share links to partitions that no longer exist
      const livePartIds = new Set(s.drives.flatMap((d) => d.partitions.map((p) => p.id)))
      s.shares = s.shares.filter((share) => livePartIds.has(share.partitionId))
    })

    return this.store.get().drives
  }

  async partition(plan: PartitionPlan): Promise<OperationResult> {
    const state = this.store.get()
    const drive = state.drives.find((d) => d.id === plan.driveId)
    if (!drive) return { ok: false, message: 'Drive not found' }
    if (drive.systemDisk) return { ok: false, message: 'Refusing to partition a system disk' }
    if (plan.partitions.length === 0) return { ok: false, message: 'At least one partition is required' }

    const platform = getPlatform()
    const first = plan.partitions[0]

    if (platform === 'darwin') {
      const args = ['eraseDisk', mapDarwinFs(first.filesystem), first.label, drive.device]
      const result = await runCommand('diskutil', args)
      if (!result.ok) {
        return {
          ok: false,
          message: 'Partition failed — administrator privileges may be required',
          detail: result.stderr || `diskutil ${args.join(' ')}`
        }
      }
    } else if (platform === 'linux') {
      return {
        ok: false,
        message: 'Linux partitioning requires root (parted/mkfs). Run VaultBay with elevated privileges.',
        detail: `Example: sudo parted ${drive.device} --script mklabel gpt mkpart primary 0% 100%`
      }
    } else if (platform === 'win32') {
      return {
        ok: false,
        message: 'Windows partitioning requires an elevated PowerShell session.',
        detail: `Example: Clear-Disk -Number N -RemoveData; New-Partition -DiskNumber N -UseMaximumSize -AssignDriveLetter`
      }
    } else {
      return { ok: false, message: 'Unsupported platform for partitioning' }
    }

    await this.refresh()
    return {
      ok: true,
      message: `Partitioned ${drive.name}`,
      detail: plan.partitions.map((p) => `${p.label} · ${p.filesystem}${p.encrypt ? ' · encrypt next' : ''}`).join('\n')
    }
  }
}

function mapDarwinFs(fs: Filesystem): string {
  switch (fs) {
    case 'apfs':
      return 'APFS'
    case 'exfat':
      return 'ExFAT'
    case 'ntfs':
      return 'ExFAT'
    default:
      return 'ExFAT'
  }
}
