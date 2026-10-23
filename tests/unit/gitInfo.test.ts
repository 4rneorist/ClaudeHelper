import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { branchFromHead, gitInfo, isDirty, readBranch } from '../../src/main/gitInfo'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'claude-helper-git-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A repository's .git with only the HEAD file, which is all the branch needs. */
function fakeRepo(root: string, head: string): void {
  mkdirSync(path.join(root, '.git'), { recursive: true })
  writeFileSync(path.join(root, '.git', 'HEAD'), head)
}

const SHA = '3f2c1a9b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b'

describe('branchFromHead', () => {
  it('reads a branch, or the short commit of a detached HEAD', () => {
    expect(branchFromHead('ref: refs/heads/main\n')).toBe('main')
    expect(branchFromHead('ref: refs/heads/feature/login\n')).toBe('feature/login')
    expect(branchFromHead(`${SHA}\n`)).toBe('3f2c1a9')
    expect(branchFromHead('garbage')).toBeNull()
  })
})

describe('readBranch', () => {
  it('finds the repository from the folder or any folder inside it', async () => {
    fakeRepo(dir, 'ref: refs/heads/main\n')
    const sub = path.join(dir, 'src', 'deep')
    mkdirSync(sub, { recursive: true })
    expect(await readBranch(dir)).toBe('main')
    expect(await readBranch(sub)).toBe('main')
  })

  it('follows the .git file of a worktree', async () => {
    const real = path.join(dir, 'main-repo', '.git', 'worktrees', 'wt')
    mkdirSync(real, { recursive: true })
    writeFileSync(path.join(real, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    const worktree = path.join(dir, 'wt')
    mkdirSync(worktree)
    writeFileSync(path.join(worktree, '.git'), `gitdir: ${real}\n`)
    expect(await readBranch(worktree)).toBe('wt-branch')
  })

  it('is null outside a repository', async () => {
    expect(await readBranch(dir)).toBeNull()
    expect(await gitInfo(dir, process.env)).toBeNull()
  })
})

const hasGit = ((): boolean => {
  try {
    execFileSync('git', ['--version'])
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasGit)('isDirty', () => {
  it('sees uncommitted and untracked changes', async () => {
    execFileSync('git', ['init', '-q', '-b', 'trunk'], { cwd: dir })
    expect(await isDirty(dir, process.env)).toBe(false)
    writeFileSync(path.join(dir, 'new.txt'), 'hi')
    expect(await gitInfo(dir, process.env)).toEqual({ branch: 'trunk', dirty: true })
  })

  it('is null when git fails', async () => {
    expect(await isDirty(path.join(dir, 'missing'), process.env)).toBeNull()
  })
})
