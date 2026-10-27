import type { VaultBayApi } from '../shared/types'

export function api(): VaultBayApi {
  if (!window.vaultbay) {
    throw new Error('VaultBay bridge unavailable. Run inside the Electron app.')
  }
  return window.vaultbay
}
