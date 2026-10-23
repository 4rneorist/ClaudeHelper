import type { IPty } from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SessionManager, type SpawnFn, type StartOptions } from '../../src/main/sessionManager'

class FakePty {
  pid = 4242
  written: (string | Buffer)[] = []
  resized: [number, number][] = []
  killed = false
  private dataListeners: ((d: string) => void)[] = []
  private exitListeners: ((e: { exitCode: number }) => void)[] = []
  onData = (l: (d: string) => void): void => void this.dataListeners.push(l)
  onExit = (l: (e: { exitCode: number }) => void): void => void this.exitListeners.push(l)
  write = (d: string | Buffer): void => void this.written.push(d)
  resize = (c: number, r: number): void => void this.resized.push([c, r])
  kill = (): void => {
    this.killed = true
  }
  emitData(d: string): void {
    this.dataListeners.forEach((l) => l(d))
  }
  emitExit(code: number): void {
    this.exitListeners.forEach((l) => l({ exitCode: code }))
  }
}

const opts: StartOptions = {
  file: 'claude',
  args: [],
  cwd: '/tmp',
  env: {},
  cols: 80,
  rows: 24,
  useConptyDll: false
}

describe('SessionManager', () => {
  let pty: FakePty
  let spawn: Mock<SpawnFn>
  let onData: Mock<(id: string, data: string) => void>
  let onExit: Mock<(id: string, exitCode: number) => void>
  let manager: SessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    pty = new FakePty()
    spawn = vi.fn<SpawnFn>(() => pty as unknown as IPty)
    onData = vi.fn()
    onExit = vi.fn()
    manager = new SessionManager(spawn, { onData, onExit }, 8)
  })
  afterEach(() => vi.useRealTimers())

  it('spawns with the requested cwd and size', () => {
    const { id, pid } = manager.start(opts)
    expect(pid).toBe(4242)
    expect(manager.has(id)).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      [],
      expect.objectContaining({ cwd: '/tmp', cols: 80, rows: 24 })
    )
  })

  it('coalesces output bursts into one event', () => {
    const { id } = manager.start(opts)
    pty.emitData('a')
    pty.emitData('b')
    pty.emitData('c')
    expect(onData).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith(id, 'abc')
  })

  it('flushes pending output before reporting exit, then forgets the session', () => {
    const { id } = manager.start(opts)
    pty.emitData('bye')
    pty.emitExit(3)
    expect(onData).toHaveBeenCalledWith(id, 'bye')
    expect(onExit).toHaveBeenCalledWith(id, 3)
    expect(onData.mock.invocationCallOrder[0]).toBeLessThan(onExit.mock.invocationCallOrder[0])
    expect(manager.has(id)).toBe(false)
    expect(manager.count).toBe(0)
  })

  it('routes input and resizes to the right pty and ignores unknown ids', () => {
    const { id } = manager.start(opts)
    manager.write(id, 'hi')
    manager.resize(id, 100, 40)
    manager.write('nope', 'x')
    manager.resize('nope', 1, 1)
    expect(pty.written).toEqual(['hi'])
    expect(pty.resized).toEqual([[100, 40]])
  })

  it('survives a resize that races with process exit', () => {
    const { id } = manager.start(opts)
    pty.resize = () => {
      throw new Error('Cannot resize a pty that has already exited')
    }
    expect(() => manager.resize(id, 10, 10)).not.toThrow()
  })

  it('falls back to the system ConPTY when the bundled one fails', () => {
    spawn.mockImplementationOnce(() => {
      throw new Error('conpty.dll missing')
    })
    manager.start({ ...opts, useConptyDll: true })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[0][2]).toMatchObject({ useConptyDll: true })
    expect(spawn.mock.calls[1][2]).not.toHaveProperty('useConptyDll')
  })

  it('kills every session on killAll', () => {
    manager.start(opts)
    manager.killAll()
    expect(pty.killed).toBe(true)
  })
})

describe('SessionManager.shutdown', () => {
  it('resolves once every session has exited', async () => {
    const ptys: FakePty[] = []
    const manager = new SessionManager(
      (() => {
        const p = new FakePty()
        p.kill = () => setTimeout(() => p.emitExit(0), 5)
        ptys.push(p)
        return p as unknown as IPty
      }) as SpawnFn,
      { onData: () => {}, onExit: () => {} }
    )
    manager.start(opts)
    manager.start(opts)
    await manager.shutdown({ timeoutMs: 1000 })
    expect(manager.count).toBe(0)
  })

  it('gives up after the timeout if a process ignores the kill', async () => {
    const manager = new SessionManager(() => new FakePty() as unknown as IPty, {
      onData: () => {},
      onExit: () => {}
    })
    manager.start(opts)
    const started = Date.now()
    await manager.shutdown({ timeoutMs: 50 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
    expect(manager.count).toBe(1)
  })
})
