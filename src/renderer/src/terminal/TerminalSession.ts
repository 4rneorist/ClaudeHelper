import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { TerminalSpec } from '../../../shared/ipc'
import { useStore } from '../store'
import { classifyKey, imagePasteSequence, NEWLINE_SEQUENCE, type KeyAction } from './keybindings'
import { fontFamilyFor } from './themes'

export interface TerminalOptions {
  platform: string
  windowsBuild: number
  fontSize: number
  theme: ITheme
  /** Skip WebGL so the e2e test can read rendered text from the DOM. */
  domRenderer: boolean
  /** App-level shortcuts (tabs, zoom) are delegated back to the app. */
  onShortcut(action: KeyAction): void
}

/** Marks drags of panes/sub-tabs so a terminal does not treat them as file drops. */
export const DND_MIME = 'application/x-claudehelper'

/** Wheel distance per font-size step: one mouse-wheel notch, or a short trackpad swipe. */
const WHEEL_STEP = 50

// ---- routing of PTY output to the terminal that owns the session ------------------------------

const bySessionId = new Map<string, TerminalSession>()
// Output can arrive before startSession() has resolved in the renderer; hold it until then.
const earlyData = new Map<string, string[]>()
const earlyExit = new Map<string, number>()
let busReady = false

function ensureBus(): void {
  if (busReady) return
  busReady = true
  window.api.onData((id, data) => {
    const target = bySessionId.get(id)
    if (target) target.receive(data)
    else earlyData.set(id, [...(earlyData.get(id) ?? []), data])
  })
  window.api.onExit((id, exitCode) => {
    const target = bySessionId.get(id)
    if (target) target.exited(exitCode)
    else earlyExit.set(id, exitCode)
  })
}

// ---- one xterm instance + its process ----------------------------------------------------------

/**
 * Lives outside React so a session survives re-renders, StrictMode double-mounting and being
 * moved between sub-tabs and split panes. The React view only attaches `element` to the DOM.
 */
export class TerminalSession {
  readonly element = document.createElement('div')
  readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private sessionId: string | null = null
  private startedAttempt = 0
  private opened = false
  private disposed = false
  private fitFrame = 0
  private resizeTimer: ReturnType<typeof setTimeout> | undefined
  private wheelDelta = 0

  constructor(
    readonly key: string,
    private readonly opts: TerminalOptions
  ) {
    ensureBus()
    this.element.className = 'terminal-surface'
    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: fontFamilyFor(opts.platform),
      fontSize: opts.fontSize,
      theme: opts.theme,
      scrollback: 10000,
      macOptionIsMeta: false,
      windowsPty:
        opts.platform === 'win32'
          ? { backend: 'conpty', buildNumber: opts.windowsBuild }
          : undefined,
      linkHandler: { activate: (_e, uri) => window.api.openExternal(uri) }
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))

    this.term.onData((data) => this.sessionId && window.api.write(this.sessionId, data))
    this.term.onBinary((data) => this.sessionId && window.api.write(this.sessionId, data, true))
    // Dragging a divider resizes continuously; tell the process once the size settles.
    this.term.onResize(() => {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => {
        if (this.sessionId) window.api.resize(this.sessionId, this.term.cols, this.term.rows)
      }, 40)
    })
    this.term.onTitleChange((title) =>
      useStore.getState().patchTerminal(this.key, { termTitle: title })
    )
    this.term.attachCustomKeyEventHandler((ev) => this.handleKey(ev))

    // Ctrl (or Cmd on macOS) + wheel changes the font size instead of scrolling.
    this.element.addEventListener('wheel', (e) => this.handleWheel(e), {
      capture: true,
      passive: false
    })
    this.element.addEventListener('focusin', () => useStore.getState().focusTerminal(this.key))

    this.element.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      void this.showContextMenu()
    })
    // Dropping files onto a running session inserts their paths, like a native terminal.
    this.element.addEventListener('dragover', (e) => e.preventDefault())
    this.element.addEventListener('drop', (e) => {
      if (e.dataTransfer?.types.includes(DND_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.api.getPathForFile(f))
      const quoted = paths.filter(Boolean).map((p) => (/\s/.test(p) ? `"${p}"` : p))
      if (quoted.length && this.sessionId) this.term.paste(quoted.join(' ') + ' ')
    })
  }

  attach(container: HTMLElement): void {
    container.appendChild(this.element)
    if (!this.opened) {
      this.opened = true
      this.term.open(this.element)
      if (!this.opts.domRenderer) this.loadWebgl()
    }
    this.fit()
  }

  /** Only detaches from this container: the view may already have been re-attached elsewhere. */
  detach(container: HTMLElement): void {
    if (this.element.parentElement === container) this.element.remove()
  }

  async start(attempt: number, cwd: string, spec: TerminalSpec): Promise<void> {
    if (this.disposed || attempt <= this.startedAttempt) return
    this.startedAttempt = attempt
    if (attempt > 1) this.term.reset()
    this.fit()

    const result = await window.api.startSession({
      cwd,
      spec,
      cols: this.term.cols,
      rows: this.term.rows
    })
    if (this.disposed) {
      if (result.ok) void window.api.kill(result.session.id)
      return
    }
    const store = useStore.getState()
    if (!result.ok) {
      this.term.write(`\x1b[31m${result.error}\x1b[0m\r\n`)
      store.patchTerminal(this.key, {
        status: 'error',
        error: result.error,
        errorCode: result.code
      })
      return
    }

    const { id } = result.session
    this.sessionId = id
    bySessionId.set(id, this)
    store.patchTerminal(this.key, {
      status: 'running',
      session: result.session,
      startedAt: Date.now()
    })
    void window.api.getSettings().then(store.setSettings) // main recorded a recent folder

    for (const chunk of earlyData.get(id) ?? []) this.receive(chunk)
    earlyData.delete(id)
    const exitCode = earlyExit.get(id)
    if (exitCode !== undefined) {
      earlyExit.delete(id)
      this.exited(exitCode)
    }
    // The container may have changed size while the process was starting.
    this.fit()
    window.api.resize(id, this.term.cols, this.term.rows)
  }

  receive(data: string): void {
    this.term.write(data)
  }

  exited(exitCode: number): void {
    if (this.sessionId) bySessionId.delete(this.sessionId)
    this.sessionId = null
    this.term.write(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    useStore.getState().patchTerminal(this.key, { status: 'exited', exitCode })
  }

  /** Coalesces bursts of ResizeObserver callbacks into one fit per frame. */
  scheduleFit(): void {
    cancelAnimationFrame(this.fitFrame)
    this.fitFrame = requestAnimationFrame(() => this.fit())
  }

  fit(): void {
    if (!this.opened || this.element.clientWidth === 0 || this.element.clientHeight === 0) return
    try {
      this.fitAddon.fit()
    } catch {
      // Renderer not ready yet (e.g. font still loading); the next resize will fit.
    }
  }

  focus(): void {
    this.term.focus()
  }

  setAppearance(fontSize: number, theme: ITheme): void {
    if (this.term.options.fontSize !== fontSize) this.term.options.fontSize = fontSize
    if (this.term.options.theme !== theme) this.term.options.theme = theme
    this.fit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.fitFrame)
    clearTimeout(this.resizeTimer)
    if (this.sessionId) {
      bySessionId.delete(this.sessionId)
      void window.api.kill(this.sessionId)
      this.sessionId = null
    }
    this.term.dispose()
    this.element.remove()
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon()
      // Fall back to the DOM renderer if the GPU context goes away (driver reset, sleep…).
      webgl.onContextLoss(() => webgl.dispose())
      this.term.loadAddon(webgl)
    } catch {
      // WebGL unavailable: xterm keeps using its DOM renderer.
    }
  }

  private handleWheel(e: WheelEvent): void {
    const zoomKey = this.opts.platform === 'darwin' ? e.metaKey || e.ctrlKey : e.ctrlKey
    if (!zoomKey) return
    e.preventDefault()
    e.stopPropagation() // keep xterm from scrolling
    // deltaMode 1 = lines (some mice); normalise to pixels.
    this.wheelDelta += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    while (Math.abs(this.wheelDelta) >= WHEEL_STEP) {
      const up = this.wheelDelta < 0
      this.wheelDelta += up ? WHEEL_STEP : -WHEEL_STEP
      this.opts.onShortcut({ type: 'zoom', delta: up ? 1 : -1 })
    }
  }

  private handleKey(ev: KeyboardEvent): boolean {
    const action = classifyKey(ev, this.opts.platform, this.term.hasSelection())
    if (action.type === 'pass') return true
    ev.preventDefault() // also stops the browser's native paste, which xterm would handle again
    switch (action.type) {
      case 'block':
        break
      case 'copy':
        this.copySelection()
        break
      case 'paste':
        void this.paste()
        break
      case 'newline':
        if (this.sessionId) window.api.write(this.sessionId, NEWLINE_SEQUENCE)
        break
      default:
        this.opts.onShortcut(action)
    }
    return false
  }

  private copySelection(): void {
    const text = this.term.getSelection()
    if (text) window.api.writeClipboard(text)
    this.term.clearSelection()
  }

  private async paste(): Promise<void> {
    const { text, hasImage } = await window.api.readClipboard()
    if (text)
      this.term.paste(text) // honours bracketed paste, so multi-line text isn't submitted early
    else if (hasImage && this.sessionId) {
      window.api.write(this.sessionId, imagePasteSequence(this.opts.platform))
    }
  }

  private async showContextMenu(): Promise<void> {
    const choice = await window.api.contextMenu(this.term.hasSelection())
    if (choice === 'copy') this.copySelection()
    else if (choice === 'paste') await this.paste()
    else if (choice === 'selectAll') this.term.selectAll()
    this.focus()
  }
}

// ---- registry: one TerminalSession per terminal key --------------------------------------------

const terminals = new Map<string, TerminalSession>()

export function ensureTerminal(key: string, opts: TerminalOptions): TerminalSession {
  let terminal = terminals.get(key)
  if (!terminal) {
    terminal = new TerminalSession(key, opts)
    terminals.set(key, terminal)
  }
  return terminal
}

export function getTerminal(key: string): TerminalSession | undefined {
  return terminals.get(key)
}

export function disposeTerminal(key: string): void {
  terminals.get(key)?.dispose()
  terminals.delete(key)
}
