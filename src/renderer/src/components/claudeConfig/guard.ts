import { createContext, useContext, useEffect, useState } from 'react'

/** State shared by the "Claude Code" window's panes. */

export interface Guard {
  /** The open editor has changes that aren't saved. */
  setDirty(dirty: boolean): void
  /** Asks before unsaved changes are thrown away; true when it may go on. */
  leave(): Promise<boolean>
}

export const GuardContext = createContext<Guard>({
  setDirty: () => {},
  leave: async () => true
})

export const useGuard = (): Guard => useContext(GuardContext)

/** Tells the window while this editor has unsaved changes. */
export function useDirty(dirty: boolean): void {
  const guard = useGuard()
  useEffect(() => {
    guard.setDirty(dirty)
    return () => guard.setDirty(false)
  }, [guard, dirty])
}

/**
 * Loads data when `load` changes (a new folder, say) and again on reload(); keeps showing what
 * it had while it loads anew.
 */
export function useLoad<T>(load: () => Promise<T>): {
  data: T | null
  loading: boolean
  reload(): void
} {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ load: () => Promise<T>; version: number; data: T } | null>(
    null
  )
  useEffect(() => {
    let live = true
    void load().then((data) => {
      if (live) setState({ load, version, data })
    })
    return () => {
      live = false
    }
  }, [load, version])
  return {
    data: state?.load === load ? state.data : null,
    loading: state?.load !== load || state.version !== version,
    reload: () => setVersion((v) => v + 1)
  }
}

export interface Status {
  ok: boolean
  text: string
}

/** Where deleted files go, by the platform's name for it. */
export function trashName(platform: string): string {
  return platform === 'win32' ? 'the Recycle Bin' : 'the Trash'
}

/** The folder a file is in (paths come from main, with the platform's separators). */
export function parentOf(file: string): string {
  return file.replace(/[\\/][^\\/]+$/, '')
}
