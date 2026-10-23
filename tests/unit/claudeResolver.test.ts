import { describe, expect, it } from 'vitest'
import {
  buildCommand,
  buildEnv,
  findClaude,
  knownSessionArgs,
  launchArgs,
  parseShellEnvOutput,
  type ResolveDeps
} from '../../src/main/claudeResolver'

function deps(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, files: string[]): ResolveDeps {
  const set = new Set(files)
  return {
    platform,
    env,
    homedir: platform === 'win32' ? 'C:\\Users\\me' : '/home/me',
    isFile: (p) => set.has(p)
  }
}

describe('findClaude', () => {
  it('prefers a native claude.exe over an npm claude.cmd that comes earlier on PATH', () => {
    const d = deps('win32', { Path: 'C:\\npm;C:\\tools' }, [
      'C:\\npm\\claude.cmd',
      'C:\\tools\\claude.exe'
    ])
    expect(findClaude(undefined, d)).toBe('C:\\tools\\claude.exe')
  })

  it('reads PATH case-insensitively on Windows', () => {
    const d = deps('win32', { pAtH: 'C:\\bin' }, ['C:\\bin\\claude.exe'])
    expect(findClaude(undefined, d)).toBe('C:\\bin\\claude.exe')
  })

  it('falls back to the native installer location when PATH lacks it', () => {
    const d = deps('win32', { Path: 'C:\\Windows' }, ['C:\\Users\\me\\.local\\bin\\claude.exe'])
    expect(findClaude(undefined, d)).toBe('C:\\Users\\me\\.local\\bin\\claude.exe')
  })

  it('finds an npm shim when no exe exists', () => {
    const d = deps('win32', { Path: '', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, [
      'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd'
    ])
    expect(findClaude(undefined, d)).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd')
  })

  it('searches unix PATH and common install dirs', () => {
    expect(findClaude(undefined, deps('linux', { PATH: '/usr/bin:/bin' }, ['/bin/claude']))).toBe(
      '/bin/claude'
    )
    expect(
      findClaude(undefined, deps('darwin', { PATH: '/usr/bin' }, ['/opt/homebrew/bin/claude']))
    ).toBe('/opt/homebrew/bin/claude')
    expect(findClaude(undefined, deps('linux', { PATH: '' }, ['/home/me/.local/bin/claude']))).toBe(
      '/home/me/.local/bin/claude'
    )
  })

  it('uses an explicit path only if it exists', () => {
    const d = deps('linux', { PATH: '/usr/bin' }, ['/usr/bin/claude', '/opt/c/claude'])
    expect(findClaude('/opt/c/claude', d)).toBe('/opt/c/claude')
    expect(findClaude('/missing/claude', d)).toBeNull()
  })

  it('returns null when nothing is found', () => {
    expect(findClaude(undefined, deps('linux', { PATH: '/usr/bin' }, []))).toBeNull()
  })
})

describe('launchArgs', () => {
  it('maps launch modes to CLI flags', () => {
    expect(launchArgs('new')).toEqual([])
    expect(launchArgs('continue')).toEqual(['--continue'])
    expect(launchArgs('resume')).toEqual(['--resume'])
  })
})

describe('knownSessionArgs', () => {
  it('resumes a conversation with a transcript, otherwise starts it under that id', () => {
    expect(knownSessionArgs('abc', true)).toEqual(['--resume', 'abc'])
    expect(knownSessionArgs('abc', false)).toEqual(['--session-id', 'abc'])
  })
})

describe('buildCommand', () => {
  it('runs executables directly', () => {
    const cmd = buildCommand('C:\\bin\\claude.exe', ['--continue'], 'win32', {})
    expect(cmd.file).toBe('C:\\bin\\claude.exe')
    expect(cmd.args).toEqual(['--continue'])
  })

  it('wraps .cmd shims in cmd.exe with a pre-quoted command line', () => {
    const cmd = buildCommand('C:\\Program Files\\npm\\claude.cmd', ['--resume'], 'win32', {
      ComSpec: 'C:\\Windows\\system32\\cmd.exe'
    })
    expect(cmd.file).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(cmd.args).toBe('/d /s /c ""C:\\Program Files\\npm\\claude.cmd" --resume"')
  })

  it('does not wrap on unix', () => {
    expect(buildCommand('/usr/bin/claude', [], 'linux', {}).args).toEqual([])
  })
})

describe('buildEnv', () => {
  it('sets terminal capabilities and drops variables that would confuse claude', () => {
    const env = buildEnv({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_USE_BEDROCK: '1',
      TERM_PROGRAM: 'vscode',
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_HELPER_E2E: '1'
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.TERM_PROGRAM).toBe('ClaudeHelper')
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(env).not.toHaveProperty('CLAUDE_CODE_CHILD_SESSION')
    expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1') // user configuration passes through
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env).not.toHaveProperty('CLAUDE_HELPER_E2E')
  })
})

describe('parseShellEnvOutput', () => {
  it('extracts JSON between markers, ignoring shell noise', () => {
    const out = 'Welcome!\n__CLAUDE_HELPER_ENV__{"PATH":"/a:/b"}__CLAUDE_HELPER_ENV__\nbye'
    expect(parseShellEnvOutput(out)).toEqual({ PATH: '/a:/b' })
  })

  it('returns null for garbage', () => {
    expect(parseShellEnvOutput('nothing here')).toBeNull()
    expect(parseShellEnvOutput('__CLAUDE_HELPER_ENV__{oops__CLAUDE_HELPER_ENV__')).toBeNull()
  })
})
