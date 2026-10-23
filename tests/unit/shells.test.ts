import { describe, expect, it } from 'vitest'
import type { ResolveDeps } from '../../src/main/claudeResolver'
import { detectShells } from '../../src/main/shells'

function deps(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, files: string[]): ResolveDeps {
  const set = new Set(files)
  return { platform, env, homedir: '/home/me', isFile: (p) => set.has(p) }
}

describe('detectShells on Windows', () => {
  const env = {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    Path: 'C:\\tools'
  }

  it('offers the installed shells in a sensible order', () => {
    const shells = detectShells(
      deps('win32', env, [
        'C:\\tools\\pwsh.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\Windows\\system32\\cmd.exe',
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Windows\\System32\\wsl.exe'
      ])
    )
    expect(shells.map((s) => s.label)).toEqual([
      'PowerShell 7',
      'Windows PowerShell',
      'Command Prompt',
      'Git Bash',
      'WSL'
    ])
    expect(shells.find((s) => s.id === 'gitbash')?.args).toEqual(['--login', '-i'])
  })

  it('omits shells that are not installed', () => {
    const shells = detectShells(deps('win32', env, ['C:\\Windows\\system32\\cmd.exe']))
    expect(shells.map((s) => s.id)).toEqual(['cmd'])
  })
})

describe('detectShells on macOS/Linux', () => {
  it('puts the login shell first and adds other installed shells', () => {
    const shells = detectShells(
      deps('darwin', { SHELL: '/bin/zsh' }, [
        '/bin/zsh',
        '/bin/bash',
        '/opt/homebrew/bin/fish',
        '/bin/sh'
      ])
    )
    expect(shells.map((s) => [s.id, s.label])).toEqual([
      ['login', 'Terminal (zsh)'],
      ['bash', 'bash'],
      ['fish', 'fish'],
      ['sh', 'sh']
    ])
    expect(shells[0].args).toEqual(['-l'])
  })

  it('works without $SHELL', () => {
    const shells = detectShells(deps('linux', {}, ['/usr/bin/bash']))
    expect(shells.map((s) => s.file)).toEqual(['/usr/bin/bash'])
  })
})
