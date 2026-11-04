import { describe, expect, it } from 'vitest'
import { jiraKeyFromBranch, jiraLink } from '../../src/renderer/src/jira'

describe('jiraKeyFromBranch', () => {
  it('finds the ticket key in a branch name', () => {
    expect(jiraKeyFromBranch('bugfix/MT-25443_AI_ingestion_UI_fixes')).toBe('MT-25443')
    expect(jiraKeyFromBranch('feature/MT-12345')).toBe('MT-12345')
    expect(jiraKeyFromBranch('MT-7-quick-fix')).toBe('MT-7')
    expect(jiraKeyFromBranch('hotfix/ABC2-99-login')).toBe('ABC2-99')
  })

  it('finds nothing in branches without a ticket', () => {
    for (const branch of [
      'master',
      'develop_2.54',
      'worktree-123',
      'release/2.54-hotfix',
      'a1b2c3d'
    ]) {
      expect(jiraKeyFromBranch(branch)).toBeNull()
    }
  })
})

describe('jiraLink', () => {
  it('puts the key where {key} is, or at the end', () => {
    expect(jiraLink('https://acme.atlassian.net/browse/{key}', 'MT-1')).toBe(
      'https://acme.atlassian.net/browse/MT-1'
    )
    expect(jiraLink('https://acme.atlassian.net/browse/', 'MT-1')).toBe(
      'https://acme.atlassian.net/browse/MT-1'
    )
  })

  it('gives nothing without a URL', () => {
    expect(jiraLink('', 'MT-1')).toBeNull()
    expect(jiraLink('   ', 'MT-1')).toBeNull()
  })
})
