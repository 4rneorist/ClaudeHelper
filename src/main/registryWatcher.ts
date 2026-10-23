import { watch, type FSWatcher } from 'fs'
import path from 'path'
import { readRunningSessions, type RunningSession } from './claudeSessions'

const DEBOUNCE_MS = 300

/** Which process has which conversation open; registry status/timestamp updates don't count. */
export function registrySignature(entries: RunningSession[]): string {
  return entries
    .map((e) => `${e.pid}:${e.sessionId}`)
    .sort()
    .join(',')
}

/**
 * Watches Claude Code's registry of running sessions (<config>/sessions) and calls `onChange`
 * when a conversation is opened, resumed or switched (/clear, /resume, the Resume… picker), so
 * the UI state can be saved right away instead of on the next periodic save.
 */
export function watchRegistry(
  configDir: () => string,
  onChange: () => void
): { ensure(): void; close(): void } {
  let watcher: FSWatcher | null = null
  let timer: NodeJS.Timeout | undefined
  let last = ''

  const check = async (): Promise<void> => {
    const signature = registrySignature(await readRunningSessions(configDir()))
    if (signature === last) return
    last = signature
    onChange()
  }

  return {
    /** Starts watching if not already; the folder only exists once claude has run. */
    ensure() {
      if (watcher) return
      try {
        watcher = watch(path.join(configDir(), 'sessions'), () => {
          clearTimeout(timer)
          timer = setTimeout(() => void check(), DEBOUNCE_MS)
        })
        watcher.on('error', () => {
          watcher?.close()
          watcher = null
        })
        void check()
      } catch {
        watcher = null // not there yet; retried when the next claude session starts
      }
    },
    close() {
      clearTimeout(timer)
      watcher?.close()
      watcher = null
    }
  }
}
