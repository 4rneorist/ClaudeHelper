import { useEffect, useState } from 'react'
import type { ThemeSetting } from '../../shared/ipc'

const query = window.matchMedia('(prefers-color-scheme: dark)')

/** Resolves the "system" setting against the OS and follows OS changes live. */
export function useResolvedTheme(setting: ThemeSetting | undefined): 'dark' | 'light' {
  const [systemDark, setSystemDark] = useState(query.matches)
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  if (setting === 'dark' || setting === 'light') return setting
  return systemDark ? 'dark' : 'light'
}
