import { describe, expect, it } from 'vitest'
import {
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
