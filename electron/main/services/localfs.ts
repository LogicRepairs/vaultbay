import { existsSync, statSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join, resolve, sep } from 'path'
import type { LocalEntry, LocalRoots, OperationResult } from '../../../src/shared/types'
import { getPlatform, runCommand } from './platform'

function toPosixRel(from: string, to: string): string {
  const rel = to.startsWith(from) ? to.slice(from.length).replace(/^[/\\]+/, '') : basename(to)
  return rel.split(sep).join('/')
}

export class LocalFsService {
  async getRoots(): Promise<LocalRoots> {
    const home = homedir()
    const platform = getPlatform()
    const favorites = [
      { name: 'Home', path: home },
      { name: 'Desktop', path: join(home, 'Desktop') },
      { name: 'Documents', path: join(home, 'Documents') },
      { name: 'Downloads', path: join(home, 'Downloads') }
    ].filter((item) => existsSync(item.path))

    const drives: { name: string; path: string }[] = []
    if (platform === 'win32') {
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const path = `${letter}:\\`
        if (existsSync(path)) drives.push({ name: `${letter}:`, path })
      }
    } else if (platform === 'darwin') {
      try {
        const vols = await readdir('/Volumes')
        for (const name of vols) {
          drives.push({ name, path: join('/Volumes', name) })
        }
      } catch {
        // ignore
      }
    } else {
      drives.push({ name: 'Root', path: '/' })
      if (existsSync('/media')) {
        try {
          for (const name of await readdir('/media')) {
            drives.push({ name, path: join('/media', name) })
          }
        } catch {
          // ignore
        }
      }
    }

    return { home, favorites, drives }
  }

  async list(path: string): Promise<LocalEntry[]> {
    const target = resolve(path || homedir())
    const s = await stat(target)
    if (!s.isDirectory()) throw new Error('Not a folder')

    const entries = await readdir(target, { withFileTypes: true })
    const mapped: LocalEntry[] = []
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const full = join(target, entry.name)
      try {
        const info = await stat(full)
        mapped.push({
          name: entry.name,
          path: full,
          isDirectory: info.isDirectory(),
          size: info.isDirectory() ? 0 : info.size,
          mtime: info.mtime.toISOString()
        })
      } catch {
        // skip inaccessible
      }
    }
    mapped.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
    return mapped
  }

  parentPath(path: string): string | null {
    const resolved = resolve(path)
    const parent = dirname(resolved)
    if (parent === resolved) return null
    return parent
  }

  async ensureDir(path: string): Promise<OperationResult> {
    const { mkdir } = await import('fs/promises')
    await mkdir(path, { recursive: true })
    return { ok: true, message: `Ready ${path}` }
  }

  exists(path: string): boolean {
    return existsSync(path)
  }

  isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }

  /** Walk local tree for upload planning */
  async walkFiles(root: string): Promise<{ absolute: string; relative: string; isDirectory: boolean }[]> {
    const out: { absolute: string; relative: string; isDirectory: boolean }[] = []
    const walk = async (current: string) => {
      const entries = await readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue
        const absolute = join(current, entry.name)
        let isDirectory = entry.isDirectory()
        try {
          isDirectory = (await stat(absolute)).isDirectory()
        } catch {
          continue
        }
        const relative = toPosixRel(root, absolute)
        out.push({ absolute, relative, isDirectory })
        if (isDirectory) await walk(absolute)
      }
    }
    const rootStat = await stat(root)
    if (rootStat.isDirectory()) {
      out.push({ absolute: root, relative: '.', isDirectory: true })
      await walk(root)
    } else {
      out.push({ absolute: root, relative: basename(root), isDirectory: false })
    }
    return out
  }

  async revealInOs(path: string): Promise<void> {
    const platform = getPlatform()
    if (platform === 'darwin') await runCommand('open', ['-R', path])
    else if (platform === 'win32') await runCommand('explorer', ['/select,', path])
    else await runCommand('xdg-open', [dirname(path)])
  }
}
