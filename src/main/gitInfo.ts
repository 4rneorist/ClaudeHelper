import { execFile } from 'child_process'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import type { GitInfo } from '../shared/ipc'

/**
 * The repository's git directory for a folder: the nearest .git at or above it. A .git file
 * ("gitdir: …", in worktrees and submodules) points to the real one.
 */
export async function findGitDir(folder: string): Promise<string | null> {
  let dir = path.resolve(folder)
  for (;;) {
    const dotGit = path.join(dir, '.git')
    try {
      const info = await stat(dotGit)
      if (info.isDirectory()) return dotGit
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))
      if (pointer) return path.resolve(dir, pointer[1])
    } catch {
      // No .git here; look further up.
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** "main" for "ref: refs/heads/main"; the short commit for a detached HEAD. */
export function branchFromHead(head: string): string | null {
  const text = head.trim()
  const ref = /^ref:\s*(?:refs\/heads\/)?(.+)$/.exec(text)
  if (ref) return ref[1]
  return /^[0-9a-f]{40,64}$/i.test(text) ? text.slice(0, 7) : null
}

export async function readBranch(folder: string): Promise<string | null> {
  const gitDir = await findGitDir(folder)
  if (!gitDir) return null
  try {
    return branchFromHead(await readFile(path.join(gitDir, 'HEAD'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Uncommitted changes, untracked files included; null when git can't be run. Without optional
 * locks, so polling never collides with a commit Claude is making.
 */
export function isDirty(
  folder: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 3000
): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-optional-locks', 'status', '--porcelain'],
      { cwd: folder, env, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout.trim().length > 0)
    )
  })
}

/** null outside a git repository. */
export async function gitInfo(folder: string, env: NodeJS.ProcessEnv): Promise<GitInfo | null> {
  const branch = await readBranch(folder)
  return branch === null ? null : { branch, dirty: await isDirty(folder, env) }
}
