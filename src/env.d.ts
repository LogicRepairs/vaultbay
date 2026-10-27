import type { VaultBayApi } from './shared/types'

declare global {
  interface Window {
    vaultbay: VaultBayApi
  }
}

export {}
