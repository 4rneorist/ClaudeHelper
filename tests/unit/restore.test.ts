import { describe, expect, it } from 'vitest'
import { leaves } from '../../src/renderer/src/layout'
import {
  resumeSpec,
  restoredState,
  snapshot,
  type TerminalState
} from '../../src/renderer/src/store'
import type { UiState } from '../../src/shared/uiState'

const ID = '11111111-1111-4111-8111-111111111111'
const CWD = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app'

const saved: UiState = {
  version: 1,
  activeWorkspace: 0,
  workspaces: [
    {
      cwd: CWD,
      claudeCount: 3,
      activeSubTab: 1,
      subTabs: [
        { layout: { type: 'leaf', id: 'old-shell' }, activePane: 'old-shell' },
        {
          layout: {
            type: 'split',
            dir: 'column',
            children: [
              { type: 'leaf', id: 'old-a' },
              { type: 'leaf', id: 'old-b' }
            ],
            sizes: [0.3, 0.7]
          },
          activePane: 'old-b'
        }
      ]
    }
  ],
  terminals: [
    { key: 'old-shell', cwd: CWD, title: 'PowerShell', spec: { kind: 'shell', shellId: 'pwsh' } },
    {
      key: 'old-a',
      cwd: CWD,
      title: 'Claude 1',
      spec: { kind: 'claude', mode: 'new', sessionId: ID },
      claudeSessionId: ID
    },
    { key: 'old-b', cwd: CWD, title: 'Claude 2', spec: { kind: 'claude', mode: 'continue' } }
  ]
}

describe('resumeSpec', () => {
  it('turns a Claude tab with a known conversation into a resume', () => {
    expect(
      resumeSpec({ spec: { kind: 'claude', mode: 'new', sessionId: ID }, claudeSessionId: ID })
    ).toEqual({ kind: 'claude', mode: 'resume', resumeId: ID })
    // Unknown conversation: start the way it started before.
    expect(resumeSpec({ spec: { kind: 'claude', mode: 'continue' } })).toEqual({
      kind: 'claude',
      mode: 'continue'
    })
    expect(resumeSpec({ spec: { kind: 'shell', shellId: 'pwsh' } })).toEqual({
      kind: 'shell',
      shellId: 'pwsh'
    })
  })
})

describe('restoredState / snapshot', () => {
  it('rebuilds folders, tabs, splits and sizes with fresh keys', () => {
    const r = restoredState(saved)
    expect(r.workspaces).toHaveLength(1)
    const ws = r.workspaces[0]
    expect(ws).toMatchObject({ kind: 'folder', cwd: CWD, title: 'app', claudeCount: 3 })
    expect(ws.activeSubTab).toBe(ws.subTabs[1].key)
    const split = ws.subTabs[1].layout
    expect(split).toMatchObject({ type: 'split', dir: 'column', sizes: [0.3, 0.7] })
    const [a, b] = leaves(split)
    expect(a).not.toBe('old-a')
    expect(ws.subTabs[1].activePane).toBe(b)
    expect(r.terminals[a]).toMatchObject({
      title: 'Claude 1',
      status: 'starting',
      spec: { kind: 'claude', mode: 'resume', resumeId: ID },
      claudeSessionId: ID
    })
    expect(r.terminals[b].spec).toEqual({ kind: 'claude', mode: 'continue' })
  })

  it('round-trips through snapshot', () => {
    const r = restoredState(saved)
    const s = snapshot(r)
    expect(s.workspaces[0].subTabs.map((t) => t.layout.type)).toEqual(['leaf', 'split'])
    expect(s.workspaces[0].activeSubTab).toBe(1)
    expect(s.terminals.map((t) => t.title).sort()).toEqual(['Claude 1', 'Claude 2', 'PowerShell'])
  })

  it('includes pid/startedAt only for running processes, and skips the start screen', () => {
    const r = restoredState(saved)
    const [key] = Object.keys(r.terminals)
    const running: TerminalState = {
      ...r.terminals[key],
      status: 'running',
      startedAt: 123,
      session: { id: 's', cwd: CWD, pid: 42, spec: r.terminals[key].spec, command: '' }
    }
    const s = snapshot({
      ...r,
      terminals: { ...r.terminals, [key]: running },
      workspaces: [
        ...r.workspaces,
        {
          key: 'start',
          kind: 'start',
          cwd: null,
          title: 'New session',
          subTabs: [],
          activeSubTab: null,
          claudeCount: 0
        }
      ]
    })
    expect(s.workspaces).toHaveLength(1)
    expect(s.terminals.find((t) => t.key === key)).toMatchObject({ pid: 42, startedAt: 123 })
    expect(s.terminals.filter((t) => t.pid !== undefined)).toHaveLength(1)
  })
})
