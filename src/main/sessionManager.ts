import { randomUUID } from 'crypto'
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'

export type SpawnOptions = IPtyForkOptions & IWindowsPtyForkOptions
export type SpawnFn = (file: string, args: string[] | string, options: SpawnOptions) => IPty

export interface SessionEvents {
  onData(id: string, data: string): void
  onExit(id: string, exitCode: number): void
}

export interface StartOptions {
  file: string
  args: string[] | string
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  useConptyDll: boolean
}

interface Session {
  pty: IPty
  pending: string
  timer: NodeJS.Timeout | null
}

/** Flush immediately once this much output is queued, so huge bursts don't sit in memory. */
const MAX_PENDING = 256 * 1024

/**
 * Owns the PTY processes. Output is coalesced for a few ms before being forwarded, which cuts IPC
 * traffic dramatically while claude streams (it emits many tiny writes).
 */
export class SessionManager {
  private sessions = new Map<string, Session>()
  private idleWaiters: (() => void)[] = []

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly events: SessionEvents,
    private readonly batchMs = 8
  ) {}

  start(opts: StartOptions): { id: string; pid: number } {
    const id = randomUUID()
    const pty = this.spawnWithFallback(opts)
    const session: Session = { pty, pending: '', timer: null }
    this.sessions.set(id, session)

    pty.onData((data) => {
      session.pending += data
      if (session.pending.length >= MAX_PENDING) this.flush(id, session)
      else if (!session.timer)
        session.timer = setTimeout(() => this.flush(id, session), this.batchMs)
    })
    pty.onExit(({ exitCode }) => {
      this.flush(id, session)
      this.sessions.delete(id)
      this.events.onExit(id, exitCode)
      if (this.sessions.size === 0) {
        for (const resolve of this.idleWaiters.splice(0)) resolve()
      }
    })
    return { id, pid: pty.pid }
  }

  write(id: string, data: string | Buffer): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      session.pty.resize(cols, rows)
    } catch {
      // The process can exit between the check and the resize; nothing to do.
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  /**
   * Kills everything and resolves once every process has reported its exit (or after `timeoutMs`),
   * plus `graceMs`. On Windows node-pty tears a ConPTY session down asynchronously: its output
   * worker thread is terminated ~1 s after the kill (FLUSH_DATA_INTERVAL in node-pty). If the app
   * exits before that, it crashes (heap corruption / access violation), so quitting must wait.
   */
  async shutdown({ timeoutMs = 3000, graceMs = 0 } = {}): Promise<void> {
    if (this.sessions.size === 0) return
    const idle = new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    this.killAll()
    let timer: NodeJS.Timeout | undefined
    await Promise.race([idle, new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))])
    clearTimeout(timer)
    if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs))
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  get count(): number {
    return this.sessions.size
  }

  private flush(id: string, session: Session): void {
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    if (!session.pending) return
    const data = session.pending
    session.pending = ''
    this.events.onData(id, data)
  }

  private spawnWithFallback(opts: StartOptions): IPty {
    const base: SpawnOptions = {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env
    }
    if (!opts.useConptyDll) return this.spawnFn(opts.file, opts.args, base)
    try {
      return this.spawnFn(opts.file, opts.args, { ...base, useConptyDll: true })
    } catch {
      // The bundled conpty.dll/OpenConsole.exe is optional; the system ConPTY is always there.
      return this.spawnFn(opts.file, opts.args, base)
    }
  }
}
