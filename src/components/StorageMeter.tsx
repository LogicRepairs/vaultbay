import { formatBytes } from '../lib/format'
import type { FolderStats } from '../shared/types'

export function StorageMeter({ stats, label }: { stats: FolderStats | null; label: string }) {
  if (!stats) {
    return (
      <div className="storage-meter">
        <div className="meta">{label}: measuring…</div>
        <div className="meter">
          <span className="meter-pulse" style={{ width: '30%' }} />
        </div>
      </div>
    )
  }

  const capacity = stats.totalBytes || 0
  const used = stats.usedBytes ?? stats.listedBytes
  const free = stats.freeBytes
  const pct = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0

  return (
    <div className="storage-meter">
      <div className="storage-meter-top">
        <span>{label}</span>
        <span>
          {formatBytes(used)} used
          {free != null ? ` · ${formatBytes(free)} free` : ''}
        </span>
      </div>
      <div className="meter">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="meta">
        This folder: {stats.fileCount} files · {stats.folderCount} folders · {formatBytes(stats.listedBytes)} listed
        {capacity ? ` · disk ${formatBytes(capacity)}` : ''}
      </div>
    </div>
  )
}
