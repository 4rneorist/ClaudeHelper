import type { ClaudeHelperApi } from '../shared/ipc'

declare global {
  interface Window {
    api: ClaudeHelperApi
  }
}
