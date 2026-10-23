import { execFile } from 'child_process'
import { statSync } from 'fs'
import path from 'path'
import type { LaunchMode } from '../shared/ipc'

export interface ResolveDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homedir: string
  isFile: (p: string) => boolean
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Windows env keys are case-insensitive ("Path" vs "PATH"); node's process.env hides that, plain objects don't. */
export function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const match = Object.keys(env).find((k) => k.toUpperCase() === key.toUpperCase())
  return match === undefined ? undefined : env[match]
}

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Locations installers commonly use that may be missing from PATH (especially for GUI-launched apps). */
export function extraSearchDirs(deps: ResolveDeps): string[] {
  const p = pathFor(deps.platform)
  const home = deps.homedir
  if (deps.platform === 'win32') {
    const appData = getEnvValue(deps.env, 'APPDATA')
    return [p.join(home, '.local', 'bin'), ...(appData ? [p.join(appData, 'npm')] : [])]
  }
  return [
    p.join(home, '.local', 'bin'),
    p.join(home, '.claude', 'local'),
    p.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ]
}

/**
 * Finds the claude executable. An explicit path wins (and is not second-guessed).
 * On Windows a native claude.exe anywhere beats an npm-installed claude.cmd.
 */
export function findClaude(explicitPath: string | undefined, deps: ResolveDeps): string | null {
  if (explicitPath) return deps.isFile(explicitPath) ? explicitPath : null

  const p = pathFor(deps.platform)
  const delimiter = deps.platform === 'win32' ? ';' : ':'
  const pathDirs = (getEnvValue(deps.env, 'PATH') ?? '').split(delimiter).filter(Boolean)
  const dirs = [...new Set([...pathDirs, ...extraSearchDirs(deps)])]
  const names = deps.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude']

  for (const name of names) {
    for (const dir of dirs) {
      const candidate = p.join(dir, name)
      if (deps.isFile(candidate)) return candidate
    }
  }
  return null
}

export function launchArgs(mode: LaunchMode): string[] {
  switch (mode) {
    case 'continue':
      return ['--continue']
    case 'resume':
      return ['--resume']
    default:
      return []
  }
}

/**
 * Args for a conversation whose id we already know (resumed, restored, or started with one):
 * resume it if Claude Code has a transcript for it, otherwise start it fresh under that id.
 * Either way the id stays the same, so the tab can be restored again later.
 */
export function knownSessionArgs(id: string, transcriptExists: boolean): string[] {
  return transcriptExists ? ['--resume', id] : ['--session-id', id]
}

export interface PtyCommand {
  file: string
  /** node-pty accepts a pre-built command line string on Windows. */
  args: string[] | string
  display: string
}

function quoteIfNeeded(s: string): string {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** ConPTY can only CreateProcess real executables, so .cmd/.bat shims go through cmd.exe. */
export function buildCommand(
  executable: string,
  args: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): PtyCommand {
  const display = [executable, ...args].map(quoteIfNeeded).join(' ')
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const comspec = getEnvValue(env, 'ComSpec') || 'cmd.exe'
    const inner = [`"${executable}"`, ...args.map(quoteIfNeeded)].join(' ')
    return { file: comspec, args: `/d /s /c "${inner}"`, display }
  }
  return { file: executable, args, display }
}

/**
 * Environment for the claude process: inherited, minus variables that would confuse it.
 * The CLAUDE* markers are what a running Claude Code session injects into its child processes;
 * if this app was started from inside one (e.g. `npm run dev` in a Claude session), passing them on
 * would make the new session think it is a sub-session (and, for one, turn transcript saving off).
 */
export function buildEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  const drop = new Set([
    'CLAUDECODE',
    'CLAUDE_PID',
    'CLAUDE_EFFORT',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ATTENDED',
    'CLAUDE_CODE_SESSION_ID',
    'ELECTRON_RUN_AS_NODE',
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    'CLAUDE_HELPER_CLAUDE_PATH',
    'CLAUDE_HELPER_USER_DATA',
    'CLAUDE_HELPER_E2E'
  ])
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || drop.has(key.toUpperCase())) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'ClaudeHelper'
  return env
}

const ENV_MARKER = '__CLAUDE_HELPER_ENV__'

export function parseShellEnvOutput(stdout: string): Record<string, string> | null {
  const start = stdout.indexOf(ENV_MARKER)
  const end = stdout.lastIndexOf(ENV_MARKER)
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(stdout.slice(start + ENV_MARKER.length, end))
  } catch {
    return null
  }
}

/**
 * Apps launched from Finder / a desktop launcher don't inherit the login shell's PATH, so `claude`
 * installed via a shell profile would be invisible. Ask the login shell for its environment once.
 * Returns null on Windows (GUI apps get the full user environment there) or on any failure.
 */
export function loadLoginShellEnv(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  execPath: string,
  timeoutMs = 5000
): Promise<Record<string, string> | null> {
  if (platform === 'win32') return Promise.resolve(null)
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const script = `printf '%s' '${ENV_MARKER}'; ELECTRON_RUN_AS_NODE=1 '${execPath.replace(/'/g, `'\\''`)}' -e 'process.stdout.write(JSON.stringify(process.env))'; printf '%s' '${ENV_MARKER}'`
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', script], { timeout: timeoutMs, env }, (error, stdout) => {
      resolve(error ? null : parseShellEnvOutput(stdout))
    })
  })
}
