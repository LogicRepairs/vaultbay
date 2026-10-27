import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Platform } from '../../../src/shared/types'

const execFileAsync = promisify(execFile)

export function getPlatform(): Platform {
  if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') {
    return process.platform
  }
  return 'unknown'
}

export async function runCommand(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: opts?.timeoutMs ?? 30_000,
      maxBuffer: 8 * 1024 * 1024
    })
    return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', ok: true }
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message ?? 'Command failed',
      ok: false
    }
  }
}

export async function discoverHostAddresses(): Promise<string[]> {
  const platform = getPlatform()
  if (platform === 'darwin' || platform === 'linux') {
    const result = await runCommand('ifconfig', [])
    if (!result.ok) return ['127.0.0.1']
    const matches = result.stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/g) ?? []
    return matches
      .map((m) => m.replace('inet ', ''))
      .filter((ip) => ip !== '127.0.0.1')
  }
  if (platform === 'win32') {
    const result = await runCommand('ipconfig', [])
    const matches = result.stdout.match(/IPv4 Address[.\s]*:\s*(\d+\.\d+\.\d+\.\d+)/gi) ?? []
    return matches.map((m) => m.split(':').pop()?.trim() ?? '').filter(Boolean)
  }
  return ['127.0.0.1']
}
