import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs'
import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'http'
import { networkInterfaces } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { pipeline } from 'stream/promises'
import dgram from 'dgram'
import type { DiscoveredHost, HostSession, OperationResult, RemoteEntry } from '../../../src/shared/types'

export const DISCOVERY_PORT = 41234
export const DEFAULT_TRANSFER_PORT = 17890

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE'
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBuf, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolveBuf(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function hashPin(pin: string): string {
  return createHash('sha256').update(`vaultbay-pin:${pin}`).digest('hex')
}

function toPosix(p: string): string {
  return p.split(sep).join('/').replace(/^\.\//, '')
}

/** Resolve a request path inside the shared root (handles Windows/mac trailing slashes & separators). */
function safeJoin(root: string, requested: string): string | null {
  const rootResolved = resolve(root)
  let cleaned = (requested || '.').trim()
  if (!cleaned || cleaned === '.' || cleaned === './' || cleaned === '.\\') {
    return rootResolved
  }

  cleaned = cleaned.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned === '.') return rootResolved

  // Block absolute / drive-letter escapes
  if (isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) return null
  if (cleaned.split('/').some((part) => part === '..')) return null

  const full = resolve(rootResolved, cleaned)
  const rel = relative(rootResolved, full)
  if (rel.startsWith('..') || isAbsolute(rel)) return null

  // Case-insensitive containment check for Windows drive letters
  const rootKey = rootResolved.toLowerCase()
  const fullKey = full.toLowerCase()
  if (fullKey !== rootKey && !fullKey.startsWith(rootKey.endsWith(sep) ? rootKey : rootKey + sep)) {
    return null
  }
  return full
}

async function listDirectory(rootPath: string, target: string): Promise<RemoteEntry[]> {
  const entries = await readdir(target, { withFileTypes: true })
  const mapped: RemoteEntry[] = []
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue
    const full = join(target, entry.name)
    try {
      const s = await stat(full)
      const isDirectory = s.isDirectory()
      mapped.push({
        name: entry.name,
        path: toPosix(relative(rootPath, full)) || entry.name,
        isDirectory,
        size: isDirectory ? 0 : s.size,
        mtime: s.mtime.toISOString()
      })
    } catch {
      // Skip entries we cannot stat (permissions, broken links)
    }
  }
  mapped.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  return mapped
}

function lanAddresses(): string[] {
  const nets = networkInterfaces()
  const out: string[] = []
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address)
    }
  }
  return out
}

function httpJson(
  host: string,
  port: number,
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown; headers?: Record<string, string> }
): Promise<{ status: number; data: Record<string, unknown> }> {
  const payload = opts?.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body))
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      {
        host,
        port,
        path,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {}),
          ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(opts?.headers || {})
        }
      },
      async (res) => {
        try {
          const buf = await readBody(res)
          const text = buf.toString('utf8')
          const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
          resolvePromise({ status: res.statusCode || 500, data })
        } catch (error) {
          reject(error)
        }
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

export class TransferService {
  private server: Server | null = null
  private beacon: dgram.Socket | null = null
  private beaconTimer: NodeJS.Timeout | null = null
  private listener: dgram.Socket | null = null
  private discovered = new Map<string, DiscoveredHost>()
  private session: HostSession | null = null
  private pinHash = ''
  private tokens = new Set<string>()
  private rootPath = ''

  getSession(): HostSession | null {
    return this.session
  }

  listDiscovered(): DiscoveredHost[] {
    const now = Date.now()
    for (const [id, host] of this.discovered) {
      if (now - host.lastSeen > 12_000) this.discovered.delete(id)
    }
    return [...this.discovered.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }

  async startHost(input: {
    name: string
    rootPath: string
    pin: string
    port?: number
  }): Promise<HostSession> {
    if (!input.pin || input.pin.length < 4) {
      throw new Error('PIN must be at least 4 characters')
    }
    if (!input.rootPath || !existsSync(input.rootPath)) {
      throw new Error('Choose a mounted drive folder first')
    }
    const st = statSync(input.rootPath)
    if (!st.isDirectory()) throw new Error('Selected path is not a folder')

    await this.stopHost()

    const port = input.port || DEFAULT_TRANSFER_PORT
    // resolve() strips trailing separators (except drive roots) so folder opens stay valid
    this.rootPath = resolve(input.rootPath)
    this.pinHash = hashPin(input.pin)
    this.tokens.clear()

    this.server = createServer(async (req, res) => {
      try {
        await this.handleHttp(req, res)
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Server error' })
      }
    })

    await new Promise<void>((resolveReady, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(port, '0.0.0.0', () => resolveReady())
    })

    const addresses = lanAddresses()
    this.session = {
      running: true,
      name: input.name || 'VaultBay-Shop',
      rootPath: this.rootPath,
      port,
      pin: input.pin,
      addresses,
      shareHint: addresses[0]
        ? `On the customer PC, open VaultBay → Connect, then pick this shop or enter ${addresses[0]}`
        : 'On the customer PC, open VaultBay → Connect (same Wi‑Fi)'
    }

    this.startBeacon()
    return this.session
  }

  async stopHost(): Promise<OperationResult> {
    if (this.beaconTimer) clearInterval(this.beaconTimer)
    this.beaconTimer = null
    if (this.beacon) {
      try {
        this.beacon.close()
      } catch {
        // ignore
      }
    }
    this.beacon = null

    if (this.server) {
      await new Promise<void>((resolveClose) => this.server!.close(() => resolveClose()))
      this.server = null
    }
    this.session = null
    this.tokens.clear()
    this.rootPath = ''
    this.pinHash = ''
    return { ok: true, message: 'Sharing stopped' }
  }

  startDiscovery(): void {
    if (this.listener) return
    this.listener = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.listener.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString('utf8')) as {
          type?: string
          name?: string
          port?: number
          id?: string
        }
        if (data.type !== 'vaultbay-host' || !data.port || !data.name) return
        const id = data.id || `${rinfo.address}:${data.port}`
        this.discovered.set(id, {
          id,
          name: data.name,
          host: rinfo.address,
          port: data.port,
          lastSeen: Date.now()
        })
      } catch {
        // ignore bad packets
      }
    })
    this.listener.bind(DISCOVERY_PORT)
  }

  stopDiscovery(): void {
    if (!this.listener) return
    try {
      this.listener.close()
    } catch {
      // ignore
    }
    this.listener = null
  }

  private startBeacon() {
    if (!this.session) return
    this.beacon = dgram.createSocket('udp4')
    this.beacon.bind(() => {
      try {
        this.beacon!.setBroadcast(true)
      } catch {
        // ignore
      }
      const payload = Buffer.from(
        JSON.stringify({
          type: 'vaultbay-host',
          id: `${this.session!.name}:${this.session!.port}`,
          name: this.session!.name,
          port: this.session!.port
        })
      )
      const send = () => {
        try {
          this.beacon?.send(payload, 0, payload.length, DISCOVERY_PORT, '255.255.255.255')
        } catch {
          // ignore
        }
      }
      send()
      this.beaconTimer = setInterval(send, 2500)
    })
  }

  private authed(req: IncomingMessage): boolean {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    return Boolean(token && this.tokens.has(token))
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE'
      })
      res.end()
      return
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname

    if (path === '/info' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        name: this.session?.name,
        running: Boolean(this.session?.running)
      })
      return
    }

    if (path === '/auth' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { pin?: string }
      const incoming = hashPin(String(body.pin || ''))
      const a = Buffer.from(incoming)
      const b = Buffer.from(this.pinHash)
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        json(res, 401, { ok: false, message: 'Wrong PIN' })
        return
      }
      const token = randomBytes(24).toString('hex')
      this.tokens.add(token)
      json(res, 200, { ok: true, token, name: this.session?.name })
      return
    }

    if (!this.authed(req)) {
      json(res, 401, { ok: false, message: 'Sign in with PIN first' })
      return
    }

    if (path === '/list' && (req.method === 'GET' || req.method === 'POST')) {
      let requested = url.searchParams.get('path') || '.'
      if (req.method === 'POST') {
        try {
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { path?: string }
          if (body.path != null) requested = body.path
        } catch {
          json(res, 400, { ok: false, message: 'Invalid list request' })
          return
        }
      }

      const target = safeJoin(this.rootPath, requested)
      if (!target) {
        json(res, 400, { ok: false, message: `Invalid path: ${requested}` })
        return
      }

      try {
        const targetStat = await stat(target)
        if (!targetStat.isDirectory()) {
          json(res, 400, { ok: false, message: 'Not a folder' })
          return
        }
        const mapped = await listDirectory(this.rootPath, target)
        json(res, 200, {
          ok: true,
          path: toPosix(relative(this.rootPath, target)) || '.',
          entries: mapped
        })
      } catch (error) {
        json(res, 500, {
          ok: false,
          message: error instanceof Error ? error.message : 'Could not read folder'
        })
      }
      return
    }

    if (path === '/download' && req.method === 'GET') {
      const target = safeJoin(this.rootPath, url.searchParams.get('path') || '')
      if (!target) {
        json(res, 400, { ok: false, message: 'Invalid path' })
        return
      }
      const s = await stat(target)
      if (!s.isFile()) {
        json(res, 400, { ok: false, message: 'Not a file' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': s.size,
        'Content-Disposition': `attachment; filename="${basename(target)}"`,
        'Access-Control-Allow-Origin': '*'
      })
      createReadStream(target).pipe(res)
      return
    }

    if (path === '/upload' && req.method === 'POST') {
      const folder = safeJoin(this.rootPath, url.searchParams.get('path') || '.')
      const fileName = basename(
        req.headers['x-file-name']?.toString() || url.searchParams.get('name') || 'upload.bin'
      )
      if (!folder || !fileName) {
        json(res, 400, { ok: false, message: 'Invalid upload target' })
        return
      }
      await mkdir(folder, { recursive: true })
      const dest = join(folder, fileName)
      const tmp = `${dest}.partial-${randomBytes(4).toString('hex')}`
      await pipeline(req, createWriteStream(tmp))
      await rename(tmp, dest)
      json(res, 200, {
        ok: true,
        message: `Uploaded ${fileName}`,
        path: relative(this.rootPath, dest).split(sep).join('/')
      })
      return
    }

    if (path === '/mkdir' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as {
        path?: string
        name?: string
      }
      const folder = safeJoin(this.rootPath, body.path || '.')
      const name = (body.name || '').trim()
      if (!folder || !name) {
        json(res, 400, { ok: false, message: 'Folder name required' })
        return
      }
      mkdirSync(join(folder, name), { recursive: true })
      json(res, 200, { ok: true, message: `Created ${name}` })
      return
    }

    if (path === '/delete' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { path?: string }
      const target = safeJoin(this.rootPath, body.path || '')
      if (!target || target === this.rootPath) {
        json(res, 400, { ok: false, message: 'Invalid path' })
        return
      }
      await rm(target, { recursive: true, force: true })
      json(res, 200, { ok: true, message: 'Deleted' })
      return
    }

    json(res, 404, { ok: false, message: 'Not found' })
  }

  async clientAuth(host: string, port: number, pin: string): Promise<{ token: string; name: string }> {
    const { status, data } = await httpJson(host, port, 'POST', '/auth', { body: { pin } })
    if (status >= 400 || !data.ok || !data.token) {
      throw new Error(String(data.message || 'Could not connect'))
    }
    return { token: String(data.token), name: String(data.name || host) }
  }

  async clientList(host: string, port: number, token: string, path: string): Promise<RemoteEntry[]> {
    const { status, data } = await httpJson(host, port, 'POST', '/list', {
      token,
      body: { path: path || '.' }
    })
    if (status >= 400 || !data.ok) throw new Error(String(data.message || 'List failed'))
    return (data.entries as RemoteEntry[]) || []
  }

  async clientDownload(
    host: string,
    port: number,
    token: string,
    remotePath: string,
    localPath: string
  ): Promise<OperationResult> {
    await new Promise<void>((resolvePromise, reject) => {
      const req = httpRequest(
        {
          host,
          port,
          path: `/download?path=${encodeURIComponent(remotePath)}`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        },
        async (res) => {
          if ((res.statusCode || 500) >= 400) {
            const buf = await readBody(res)
            reject(new Error(buf.toString('utf8') || 'Download failed'))
            return
          }
          try {
            await pipeline(res, createWriteStream(localPath))
            resolvePromise()
          } catch (error) {
            reject(error)
          }
        }
      )
      req.on('error', reject)
      req.end()
    })
    return { ok: true, message: `Saved ${basename(localPath)}`, detail: localPath }
  }

  async clientUpload(
    host: string,
    port: number,
    token: string,
    remoteFolder: string,
    localPath: string
  ): Promise<OperationResult> {
    const name = basename(localPath)
    const size = statSync(localPath).size
    await new Promise<void>((resolvePromise, reject) => {
      const req = httpRequest(
        {
          host,
          port,
          path: `/upload?path=${encodeURIComponent(remoteFolder || '.')}&name=${encodeURIComponent(name)}`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-File-Name': name,
            'Content-Type': 'application/octet-stream',
            'Content-Length': size
          }
        },
        async (res) => {
          try {
            const buf = await readBody(res)
            const data = JSON.parse(buf.toString('utf8') || '{}') as { ok?: boolean; message?: string }
            if ((res.statusCode || 500) >= 400 || !data.ok) {
              reject(new Error(data.message || 'Upload failed'))
              return
            }
            resolvePromise()
          } catch (error) {
            reject(error)
          }
        }
      )
      req.on('error', reject)
      createReadStream(localPath).pipe(req)
    })
    return { ok: true, message: `Uploaded ${name}` }
  }

  async clientMkdir(host: string, port: number, token: string, parentPath: string, name: string) {
    const { status, data } = await httpJson(host, port, 'POST', '/mkdir', {
      token,
      body: { path: parentPath || '.', name }
    })
    if (status >= 400 || !data.ok) throw new Error(String(data.message || 'Could not create folder'))
  }

  /** Download a remote file or whole folder tree into a local destination folder. */
  async transferRemoteToLocal(
    host: string,
    port: number,
    token: string,
    remotePath: string,
    localDestFolder: string,
    onProgress?: (message: string) => void
  ): Promise<OperationResult> {
    const { mkdir } = await import('fs/promises')
    await mkdir(localDestFolder, { recursive: true })

    const remoteName = basename(remotePath.replace(/\\/g, '/')) || 'download'
    // Detect whether remote path is a folder by listing parent / trying list
    let isDirectory = false
    try {
      await this.clientList(host, port, token, remotePath)
      isDirectory = true
    } catch {
      isDirectory = false
    }

    let files = 0
    const downloadTree = async (remote: string, localDir: string) => {
      const entries = await this.clientList(host, port, token, remote)
      for (const entry of entries) {
        const localTarget = join(localDir, entry.name)
        if (entry.isDirectory) {
          await mkdir(localTarget, { recursive: true })
          onProgress?.(`Folder ${entry.path}`)
          await downloadTree(entry.path, localTarget)
        } else {
          onProgress?.(`Downloading ${entry.name}`)
          await this.clientDownload(host, port, token, entry.path, localTarget)
          files += 1
        }
      }
    }

    if (isDirectory) {
      const destRoot = join(localDestFolder, remoteName)
      await mkdir(destRoot, { recursive: true })
      await downloadTree(remotePath, destRoot)
      return {
        ok: true,
        message: `Transferred folder “${remoteName}” (${files} files)`,
        detail: destRoot
      }
    }

    const destFile = join(localDestFolder, remoteName)
    await this.clientDownload(host, port, token, remotePath, destFile)
    return { ok: true, message: `Downloaded ${remoteName}`, detail: destFile }
  }

  /** Upload a local file or folder tree into a remote destination folder. */
  async transferLocalToRemote(
    host: string,
    port: number,
    token: string,
    localPath: string,
    remoteDestFolder: string,
    onProgress?: (message: string) => void
  ): Promise<OperationResult> {
    const { readdir } = await import('fs/promises')
    const localName = basename(localPath)
    const isDirectory = statSync(localPath).isDirectory()
    let files = 0

    const uploadTree = async (absolute: string, remoteFolder: string) => {
      const entries = await readdir(absolute, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue
        const child = join(absolute, entry.name)
        let childIsDir = entry.isDirectory()
        try {
          childIsDir = (await stat(child)).isDirectory()
        } catch {
          continue
        }
        if (childIsDir) {
          onProgress?.(`Creating ${entry.name}`)
          await this.clientMkdir(host, port, token, remoteFolder, entry.name)
          const nextRemote =
            !remoteFolder || remoteFolder === '.' ? entry.name : `${remoteFolder.replace(/\/+$/, '')}/${entry.name}`
          await uploadTree(child, nextRemote)
        } else {
          onProgress?.(`Uploading ${entry.name}`)
          await this.clientUpload(host, port, token, remoteFolder, child)
          files += 1
        }
      }
    }

    if (isDirectory) {
      await this.clientMkdir(host, port, token, remoteDestFolder || '.', localName)
      const nextRemote =
        !remoteDestFolder || remoteDestFolder === '.'
          ? localName
          : `${remoteDestFolder.replace(/\/+$/, '')}/${localName}`
      await uploadTree(localPath, nextRemote)
      return {
        ok: true,
        message: `Uploaded folder “${localName}” (${files} files)`,
        detail: nextRemote
      }
    }

    await this.clientUpload(host, port, token, remoteDestFolder || '.', localPath)
    return { ok: true, message: `Uploaded ${localName}` }
  }
}
