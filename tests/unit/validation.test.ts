import { describe, expect, it } from 'vitest'
import {
  checkContextMenuRequest,
  checkFileLinkRequest,
  checkSpec,
  checkStartRequest,
  isDimension,
  isSafeExternalUrl
} from '../../src/main/validation'

const abs = process.platform === 'win32' ? 'C:\\work' : '/work'
const exists = (p: string): boolean => p === abs
const claude = { kind: 'claude', mode: 'new' }
const SESSION = '0bcd6d6b-1111-4222-8333-444455556666'

describe('checkStartRequest', () => {
  it('accepts a well-formed request', () => {
    const spec = { kind: 'claude', mode: 'continue' }
    const r = checkStartRequest({ cwd: abs, spec, cols: 120, rows: 30 }, exists)
    expect(r).toEqual({ ok: true, req: { cwd: abs, spec, cols: 120, rows: 30 } })
  })

  it('rejects unknown specs and bad sizes', () => {
    const bad = { kind: 'claude', mode: 'rm -rf' }
    expect(checkStartRequest({ cwd: abs, spec: bad, cols: 80, rows: 24 }, exists)).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST'
    })
    expect(checkStartRequest({ cwd: abs, spec: claude, cols: 0, rows: 24 }, exists)).toMatchObject({
      ok: false
    })
    expect(
      checkStartRequest({ cwd: abs, spec: claude, cols: 80.5, rows: 24 }, exists)
    ).toMatchObject({ ok: false })
    expect(checkStartRequest(null, exists)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
  })

  it('rejects relative or missing folders', () => {
    expect(
      checkStartRequest({ cwd: 'work', spec: claude, cols: 80, rows: 24 }, () => true)
    ).toMatchObject({ ok: false, code: 'INVALID_CWD' })
    const missing = process.platform === 'win32' ? 'C:\\nope' : '/nope'
    expect(
      checkStartRequest({ cwd: missing, spec: claude, cols: 80, rows: 24 }, exists)
    ).toMatchObject({ ok: false, code: 'INVALID_CWD' })
  })
})

describe('checkSpec', () => {
  it('accepts claude modes and an exact session to resume', () => {
    expect(checkSpec({ kind: 'claude', mode: 'new' })).toEqual({ kind: 'claude', mode: 'new' })
    expect(checkSpec({ kind: 'claude', mode: 'resume', resumeId: SESSION })).toEqual({
      kind: 'claude',
      mode: 'resume',
      resumeId: SESSION
    })
  })

  it('rejects session ids that are not UUIDs or not paired with resume', () => {
    expect(checkSpec({ kind: 'claude', mode: 'resume', resumeId: '--dangerous' })).toBeNull()
    expect(checkSpec({ kind: 'claude', mode: 'new', resumeId: SESSION })).toBeNull()
  })

  it('accepts shell ids and drops unknown fields', () => {
    expect(checkSpec({ kind: 'shell', shellId: 'pwsh', file: 'evil.exe' })).toEqual({
      kind: 'shell',
      shellId: 'pwsh'
    })
    expect(checkSpec({ kind: 'shell', shellId: '../../bin/sh' })).toBeNull()
    expect(checkSpec({ kind: 'other' })).toBeNull()
  })
})

describe('isDimension', () => {
  it('accepts sane integers only', () => {
    expect(isDimension(80)).toBe(true)
    expect(isDimension(0)).toBe(false)
    expect(isDimension(5000)).toBe(false)
    expect(isDimension('80')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('only allows http(s)', () => {
    expect(isSafeExternalUrl('https://claude.ai/oauth?x=1')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl(42)).toBe(false)
  })
})

describe('checkSpec session ids', () => {
  const ID = '0bcd6d6b-1111-4222-8333-444455556666'
  it('allows a fixed id only for new conversations', () => {
    expect(checkSpec({ kind: 'claude', mode: 'new', sessionId: ID })).toEqual({
      kind: 'claude',
      mode: 'new',
      sessionId: ID
    })
    expect(checkSpec({ kind: 'claude', mode: 'continue', sessionId: ID })).toBeNull()
    expect(checkSpec({ kind: 'claude', mode: 'new', sessionId: 'nope' })).toBeNull()
    expect(checkSpec({ kind: 'claude', mode: 'resume', resumeId: ID, sessionId: ID })).toBeNull()
  })
})

describe('checkContextMenuRequest', () => {
  const target = { key: 'term-12', label: 'Claude 2 · my project' }

  it('accepts the selection flags and the sessions to send to', () => {
    expect(
      checkContextMenuRequest({ hasSelection: true, canSnip: false, targets: [target] })
    ).toEqual({ hasSelection: true, canSnip: false, targets: [target] })
  })

  it('drops targets with odd keys, cuts long labels and caps the list', () => {
    const r = checkContextMenuRequest({
      hasSelection: false,
      canSnip: true,
      targets: [
        { key: '../evil', label: 'x' },
        { key: 'term-1', label: 42 },
        { key: 'term-2', label: 'y'.repeat(500) },
        ...Array.from({ length: 80 }, (_, i) => ({ key: `term-${i + 10}`, label: 'z' }))
      ]
    })
    expect(r.targets[0]).toEqual({ key: 'term-2', label: 'y'.repeat(200) })
    expect(r.targets).toHaveLength(50)
    expect(r.canSnip).toBe(true)
  })

  it('treats anything malformed as an empty request', () => {
    expect(checkContextMenuRequest(null)).toEqual({
      hasSelection: false,
      canSnip: false,
      targets: []
    })
  })
})

describe('checkFileLinkRequest', () => {
  it('takes a folder and the paths found in a line', () => {
    expect(checkFileLinkRequest(abs, ['src/x.ts', '~/a.png'])).toEqual({
      cwd: abs,
      paths: ['src/x.ts', '~/a.png']
    })
  })

  it('refuses a relative folder, odd paths and too many of them', () => {
    expect(checkFileLinkRequest('work', ['a.ts'])).toBeNull()
    expect(checkFileLinkRequest(abs, 'a.ts')).toBeNull()
    expect(checkFileLinkRequest(abs, [42])).toBeNull()
    expect(checkFileLinkRequest(abs, ['a\0b'])).toBeNull()
    expect(checkFileLinkRequest(abs, ['x'.repeat(2000)])).toBeNull()
    expect(checkFileLinkRequest(abs, Array(51).fill('a.ts'))).toBeNull()
  })
})
