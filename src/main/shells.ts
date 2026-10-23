import path from 'path'
import type { ShellProfile } from '../shared/ipc'
import { getEnvValue, type ResolveDeps } from './claudeResolver'

export interface ShellDef extends ShellProfile {
  file: string
  args: string[]
}

function findOnPath(name: string, deps: ResolveDeps): string | null {
  const p = deps.platform === 'win32' ? path.win32 : path.posix
  const delimiter = deps.platform === 'win32' ? ';' : ':'
  for (const dir of (getEnvValue(deps.env, 'PATH') ?? '').split(delimiter).filter(Boolean)) {
    const candidate = p.join(dir, name)
    if (deps.isFile(candidate)) return candidate
  }
  return null
}

function firstExisting(
  candidates: (string | null | undefined)[],
  deps: ResolveDeps
): string | null {
  for (const c of candidates) if (c && deps.isFile(c)) return c
  return null
}

function windowsShells(deps: ResolveDeps): ShellDef[] {
  const w = path.win32
  const env = (k: string): string | undefined => getEnvValue(deps.env, k)
  const systemRoot = env('SystemRoot') || 'C:\\Windows'
  const programFiles = env('ProgramFiles') || 'C:\\Program Files'
  const programFilesX86 = env('ProgramFiles(x86)')
  const localAppData = env('LOCALAPPDATA')
  const system32 = w.join(systemRoot, 'System32')
  const shells: ShellDef[] = []

  const pwsh = firstExisting(
    [findOnPath('pwsh.exe', deps), w.join(programFiles, 'PowerShell', '7', 'pwsh.exe')],
    deps
  )
  if (pwsh) shells.push({ id: 'pwsh', label: 'PowerShell 7', file: pwsh, args: ['-NoLogo'] })

  const powershell = w.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (deps.isFile(powershell)) {
    shells.push({
      id: 'powershell',
      label: 'Windows PowerShell',
      file: powershell,
      args: ['-NoLogo']
    })
  }

  const cmd = firstExisting([env('ComSpec'), w.join(system32, 'cmd.exe')], deps)
  if (cmd) shells.push({ id: 'cmd', label: 'Command Prompt', file: cmd, args: [] })

  const gitBash = firstExisting(
    [
      w.join(programFiles, 'Git', 'bin', 'bash.exe'),
      programFilesX86 && w.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
      localAppData && w.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')
    ],
    deps
  )
  if (gitBash)
    shells.push({ id: 'gitbash', label: 'Git Bash', file: gitBash, args: ['--login', '-i'] })

  const wsl = w.join(system32, 'wsl.exe')
  if (deps.isFile(wsl)) shells.push({ id: 'wsl', label: 'WSL', file: wsl, args: [] })

  return shells
}

const UNIX_CANDIDATES: Record<string, string[]> = {
  zsh: ['/bin/zsh', '/usr/bin/zsh', '/opt/homebrew/bin/zsh', '/usr/local/bin/zsh'],
  bash: ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash'],
  fish: ['/usr/bin/fish', '/opt/homebrew/bin/fish', '/usr/local/bin/fish'],
  sh: ['/bin/sh']
}

function unixShells(deps: ResolveDeps): ShellDef[] {
  const shells: ShellDef[] = []
  const login = deps.env.SHELL
  const loginName = login ? path.posix.basename(login) : null
  if (login && deps.isFile(login)) {
    shells.push({ id: 'login', label: `Terminal (${loginName})`, file: login, args: ['-l'] })
  }
  for (const [name, candidates] of Object.entries(UNIX_CANDIDATES)) {
    if (name === loginName) continue
    const file = firstExisting(candidates, deps)
    if (file) shells.push({ id: name, label: name, file, args: name === 'sh' ? [] : ['-l'] })
  }
  return shells
}

/** The shells this machine has, in the order they should be offered. */
export function detectShells(deps: ResolveDeps): ShellDef[] {
  return deps.platform === 'win32' ? windowsShells(deps) : unixShells(deps)
}
