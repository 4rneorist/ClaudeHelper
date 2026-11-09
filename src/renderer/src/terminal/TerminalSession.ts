import { Terminal, type IBuffer, type IBufferCell, type ILink, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchResultChangeEvent } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { FileLink, SendTarget, TerminalSpec } from '../../../shared/ipc'
import { hotkeyOf } from '../../../shared/hotkeys'
import { findNode, promptForHotkey } from '../bookmarks'
import { activeTerminalKey, useStore } from '../store'
import {
  activityFromTitle,
  isAsking,
  isTranscriptView,
  previewOf,
  hasTickBox,
  isSubmitScreen,
  isTicked,
  promptRows,
  promptTarget,
  questionOf,
  type ScreenQuestion
} from './claudeActivity'
import { findPaths } from './filePaths'
import { classifyKey, imagePasteSequence, NEWLINE_SEQUENCE, type KeyAction } from './keybindings'
import { fontFamilyFor, minimumContrastFor, promptFlashColor, searchDecorations } from './themes'

export interface TerminalOptions {
  platform: string
  windowsBuild: number
  fontSize: number
  theme: ITheme
  /** Skip WebGL so the e2e test can read rendered text from the DOM. */
  domRenderer: boolean
  /** App-level shortcuts (tabs, zoom) are delegated back to the app. */
  onShortcut(action: KeyAction): void
  /** Other sessions this terminal's text can be sent to, for its right-click menu. */
  sendTargets(from: string): SendTarget[]
  /** Puts text into the prompt of session `to`. */
  onSend(to: string, text: string): void
  /** Snips a region of the screen into this terminal's Claude prompt. */
  onSnip(key: string): void
  /** Starts a bookmark holding this text. */
  onBookmark(text: string): void
}

/** Marks drags of panes/sub-tabs so a terminal does not treat them as file drops. */
export const DND_MIME = 'application/x-claudehelper'

/** Wheel distance per font-size step: one mouse-wheel notch, or a short trackpad swipe. */
const WHEEL_STEP = 50

/** Once Claude stops, how long its screen has to be quiet before it is read. */
const SETTLE_QUIET_MS = 300
/** …and the longest wait after a change, since its status line can keep redrawing. */
const SETTLE_MAX_MS = 1500

/** Matches highlighted at most; the count shows "1000+" beyond. */
export const SEARCH_HIGHLIGHT_LIMIT = 1000
/** How long a message you jumped to stays highlighted. */
const PROMPT_FLASH_MS = 900
/** Text sent to a Claude that is still starting is pasted at the latest this long after. */
const PENDING_MAX_MS = 15000
/** How long after a paste Enter is pressed, so Claude takes it as a key of its own. */
const SUBMIT_DELAY_MS = 150
/** Between keys sent to move to an option, so each reaches Claude on its own. */
const KEY_GAP_MS = 60
/** How long an answer may take to change the screen, and then to finish drawing it. */
const ANSWER_WAIT_MS = 3000
const ANSWER_SETTLE_MS = 400
/** Lines read below what is shown, to cut Claude's input box off what a chat shows. */
const SCREEN_MARGIN = 30
/** Paths looked up in one line at most, as many as main takes. */
const MAX_FILE_LINKS = 50
/** Rows a wrapped line is followed over, each way, to find a path in it. */
const MAX_WRAPPED_ROWS = 30
/** What Ctrl+click does on a path, for its tooltip. */
const FILE_LINK_ACTION: Record<FileLink['kind'], string> = {
  file: 'Open file',
  folder: 'Open folder',
  program: 'Show in folder'
}

// ---- routing of PTY output to the terminal that owns the session ------------------------------

const bySessionId = new Map<string, TerminalSession>()
// Output can arrive before startSession() has resolved in the renderer; hold it until then.
const earlyData = new Map<string, string[]>()
const earlyExit = new Map<string, number>()
let busReady = false
/** The size of the last terminal fitted on screen: a hidden one starts at it, not at 80×24. */
let shownSize: { cols: number; rows: number } | null = null

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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

/**
 * A buffer row joined with the rows it wraps onto, and the cell each character is in (a wide
 * character takes two cells, an emoji two characters).
 */
function logicalLine(
  buffer: IBuffer,
  row: number
): { text: string; cells: { x: number; y: number }[] } {
  let first = row
  while (first > 0 && row - first < MAX_WRAPPED_ROWS && buffer.getLine(first)?.isWrapped) first--
  let last = row
  while (last - row < MAX_WRAPPED_ROWS && buffer.getLine(last + 1)?.isWrapped) last++
  let text = ''
  const cells: { x: number; y: number }[] = []
  let cell: IBufferCell | undefined
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y)
    for (let x = 0; line && x < line.length; x++) {
      cell = line.getCell(x, cell)
      if (!cell || cell.getWidth() === 0) continue
      const chars = cell.getChars() || ' '
      text += chars
      for (let i = 0; i < chars.length; i++) cells.push({ x, y })
    }
  }
  return { text, cells }
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
  private readonly searchAddon = new SearchAddon({ highlightLimit: SEARCH_HIGHLIGHT_LIMIT })
  private sessionId: string | null = null
  /** When the process last wrote, epoch ms. */
  private lastOutputAt = 0
  private startedAttempt = 0
  private opened = false
  private disposed = false
  /** The app's theme (the terminal's own differs with a picture behind it). */
  private theme: ITheme
  private seeThrough = false
  private webgl: WebglAddon | null = null
  private fitFrame = 0
  private resizeTimer: ReturnType<typeof setTimeout> | undefined
  private wheelDelta = 0
  /** Claude's title says it stopped working: finished, or asking you something. */
  private stopped = false
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  /** When to read the screen at the latest, epoch ms; 0 when no read is pending. */
  private settleBy = 0
  /** Claude has set its title, so its prompt is drawn and takes what is pasted. */
  private ready = false
  /** Text sent here before it was ready. */
  private pending: string[] = []
  /** Enter is pressed once the pending text is pasted. */
  private submitPending = false
  private pendingTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    readonly key: string,
    private readonly opts: TerminalOptions
  ) {
    ensureBus()
    this.element.className = 'terminal-surface'
    this.theme = opts.theme
    const openUrl = (e: MouseEvent, uri: string): void => {
      if (this.followsLink(e)) window.api.openExternal(uri)
    }
    const urlHint = {
      hover: () => this.hintLink('Follow link'),
      leave: () => this.hintLink(null)
    }
    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: fontFamilyFor(opts.platform),
      fontSize: opts.fontSize,
      theme: opts.theme,
      minimumContrastRatio: minimumContrastFor(opts.theme),
      scrollback: 10000,
      macOptionIsMeta: false,
      windowsPty:
        opts.platform === 'win32'
          ? { backend: 'conpty', buildNumber: opts.windowsBuild }
          : undefined,
      linkHandler: { activate: openUrl, ...urlHint }
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(new WebLinksAddon(openUrl, urlHint))
    this.term.registerLinkProvider({
      provideLinks: (y, callback) =>
        void this.fileLinks(y).then(callback, () => callback(undefined))
    })
    this.term.loadAddon(this.searchAddon)
    // Matches belong to one buffer: when a program switches screens (Claude leaving its
    // transcript view), they are gone.
    this.term.buffer.onBufferChange(() => {
      if (useStore.getState().terminals[this.key]?.search !== undefined) this.closeSearch()
    })

    this.term.onData((data) => this.sessionId && window.api.write(this.sessionId, data))
    this.term.onBinary((data) => this.sessionId && window.api.write(this.sessionId, data, true))
    // Dragging a divider resizes continuously; tell the process once the size settles.
    this.term.onResize(() => {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => {
        if (this.sessionId) window.api.resize(this.sessionId, this.term.cols, this.term.rows)
      }, 40)
    })
    this.term.onTitleChange((title) => {
      const store = useStore.getState()
      store.patchTerminal(this.key, { termTitle: title })
      const activity = activityFromTitle(title)
      if (activity && !this.ready) {
        this.ready = true
        this.flushPending()
      }
      // Stopped: finished or asking. Its screen tells which, once drawn.
      this.stopped = activity === 'idle'
      if (this.stopped) this.settle()
      else {
        clearTimeout(this.settleTimer)
        this.settleBy = 0
        store.reportActivity(this.key, activity, this.looking())
      }
    })
    this.term.onBell(() => useStore.getState().ringBell(this.key, this.looking()))
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
    this.ready = false
    if (attempt > 1) this.term.reset()
    this.fit()
    // Opened in the background (from Telegram): as big as the terminals on screen.
    if (this.element.clientWidth === 0 && shownSize) {
      this.term.resize(shownSize.cols, shownSize.rows)
    }

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
    this.lastOutputAt = Date.now()
    this.term.write(data)
    // While Claude is stopped its screen still changes: a prompt appears, or gets answered.
    if (this.stopped) this.settle()
  }

  exited(exitCode: number): void {
    if (this.sessionId) bySessionId.delete(this.sessionId)
    this.sessionId = null
    this.stopped = false
    this.ready = false
    clearTimeout(this.settleTimer)
    this.term.write(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    useStore.getState().patchTerminal(this.key, {
      status: 'exited',
      exitCode,
      activity: undefined,
      attention: undefined
    })
  }

  /** The user is looking at this terminal: it is the focused pane of a focused window. */
  private looking(): boolean {
    return document.hasFocus() && activeTerminalKey(useStore.getState()) === this.key
  }

  /**
   * Reads whether stopped Claude asks for something, once its screen has been quiet for a moment
   * (or has kept changing for too long, as its status line can).
   */
  private settle(): void {
    if (!this.settleBy) this.settleBy = Date.now() + SETTLE_MAX_MS
    clearTimeout(this.settleTimer)
    const wait = Math.max(0, Math.min(SETTLE_QUIET_MS, this.settleBy - Date.now()))
    this.settleTimer = setTimeout(() => {
      this.settleBy = 0
      if (!this.stopped || this.disposed) return
      const activity = isAsking(this.screenLines()) ? 'asking' : 'idle'
      useStore.getState().reportActivity(this.key, activity, this.looking())
    }, wait)
  }

  /** The choice Claude waits for, as its screen shows it; null when it isn't asking. */
  question(): ScreenQuestion | null {
    return questionOf(this.screenLines())
  }

  /**
   * The last `count` lines worth reading, Claude's input box and status line cut off: the end of
   * the scrollback too, where there is one (not in Claude's fullscreen renderer).
   */
  screenText(count: number): string[] {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let y = Math.max(0, buffer.length - count - SCREEN_MARGIN); y < buffer.length; y++) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? '')
    }
    return previewOf(lines, count)
  }

  /** Types the text into the prompt and presses Enter, as if you had (once Claude is ready). */
  submit(text: string): void {
    this.submitPending = true
    this.deliver(text)
  }

  /** Picks option `n` of the question on screen, with its number key. */
  choose(n: number): void {
    this.send(String(n))
  }

  /**
   * Answers the question in your own words: moves from the option the cursor is on to its
   * free-text option, types them there and presses Enter.
   */
  async answerText(question: ScreenQuestion, option: number, text: string): Promise<void> {
    await this.move(option - question.cursor)
    this.term.paste(text)
    setTimeout(() => this.send('\r'), SUBMIT_DELAY_MS)
  }

  /**
   * Answers a question that takes several answers: ticks exactly these options (a number key
   * flips a box and leaves the cursor where it is), types `text` into its own-words option (which
   * ticks it), then moves to Submit, just below the last box, and presses Enter.
   */
  async tick(
    question: ScreenQuestion,
    numbers: number[],
    text: string | null = null
  ): Promise<void> {
    const boxes = question.options.filter((o) => hasTickBox(o.label))
    const free = question.freeText
    let cursor = question.cursor
    // On the own-words option, number keys would be typed into it: step off it first.
    if (cursor === free) {
      const step = cursor > 1 ? -1 : 1
      await this.move(step)
      cursor += step
    }
    for (const o of boxes) {
      if (o.n === free || isTicked(o.label) === numbers.includes(o.n)) continue
      this.send(String(o.n))
      await pause(KEY_GAP_MS)
    }
    if (free !== null && text) {
      await this.move(free - cursor)
      cursor = free
      this.term.paste(text)
      await pause(SUBMIT_DELAY_MS)
    }
    const last = Math.max(...boxes.map((o) => o.n))
    await this.move(cursor <= last ? last - cursor + 1 : last - cursor)
    this.send('\r')
  }

  /**
   * What follows an answer to question `answered`: a form of several questions shows its next
   * one, returned so it can be asked in Telegram too; once all have answers it asks to submit
   * them, which is done here. null when Claude goes on with its work.
   */
  async afterAnswer(answered: string): Promise<ScreenQuestion | null> {
    if (!(await this.until(() => this.question()?.id !== answered, ANSWER_WAIT_MS))) return null
    await pause(ANSWER_SETTLE_MS) // the next screen may still be drawing
    if (isSubmitScreen(this.screenLines())) {
      this.send('1')
      return null
    }
    return this.question()
  }

  /** Moves the cursor of a question down (or, negative, up) this many rows. */
  private async move(rows: number): Promise<void> {
    for (let i = 0; i < Math.abs(rows); i++) {
      this.send(rows > 0 ? '\x1b[B' : '\x1b[A')
      await pause(KEY_GAP_MS)
    }
  }

  /** The last lines worth a glance, for the tab preview. */
  previewLines(count: number): string[] {
    return previewOf(this.screenLines(), count)
  }

  /** The text of the screen (not the scrollback, nor where the user scrolled to). */
  private screenLines(): string[] {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let y = buffer.baseY; y < buffer.baseY + this.term.rows; y++) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? '')
    }
    return lines
  }

  /** Every line of the active buffer, scrollback included. */
  private bufferLines(): string[] {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let y = 0; y < buffer.length; y++) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? '')
    }
    return lines
  }

  private isClaude(): boolean {
    return useStore.getState().terminals[this.key]?.spec.kind === 'claude'
  }

  private send(data: string): void {
    if (this.sessionId) window.api.write(this.sessionId, data)
  }

  /** Resolves true once `done()` holds, polling; false after `timeoutMs`. */
  private async until(done: () => boolean, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (!done()) {
      if (Date.now() > end || this.disposed) return false
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return true
  }

  /**
   * A fullscreen Claude draws on the alternate screen, so its conversation isn't in the
   * scrollback. Its transcript view (Ctrl+O) writes all of it there on `[`, until you leave the
   * view with Esc or q. Waits for that, so the scrollback can be searched and scrolled.
   */
  private async prepareScrollback(): Promise<void> {
    if (!this.sessionId || this.term.buffer.active.type !== 'alternate' || !this.isClaude()) return
    if (!isTranscriptView(this.screenLines())) {
      this.send('\x0f') // Ctrl+O
      if (!(await this.until(() => isTranscriptView(this.screenLines()), 2000))) return
    }
    this.send('[')
    if (await this.until(() => this.term.buffer.active.type === 'normal', 3000)) {
      await this.until(() => Date.now() - this.lastOutputAt > 200, 2000)
    }
  }

  /** Opens the search bar, or brings the focus back to it. */
  async openSearch(): Promise<void> {
    await this.prepareScrollback()
    const store = useStore.getState()
    store.patchTerminal(this.key, { search: (store.terminals[this.key]?.search ?? 0) + 1 })
  }

  /** Highlights every match and moves to the next or previous one; false when there is none. */
  find(query: string, direction: 'next' | 'previous', incremental = false): boolean {
    if (!query) {
      this.searchAddon.clearDecorations()
      return false
    }
    const options = { incremental, decorations: searchDecorations(this.theme) }
    return direction === 'next'
      ? this.searchAddon.findNext(query, options)
      : this.searchAddon.findPrevious(query, options)
  }

  onSearchResults(listener: (results: ISearchResultChangeEvent) => void): () => void {
    const subscription = this.searchAddon.onDidChangeResults(listener)
    return () => subscription.dispose()
  }

  closeSearch(): void {
    this.searchAddon.clearDecorations()
    useStore.getState().patchTerminal(this.key, { search: undefined })
    this.focus()
  }

  /** Scrolls your previous (-1) or next (1) message to Claude to the top, and flashes it. */
  async jumpToPrompt(dir: 1 | -1): Promise<void> {
    await this.prepareScrollback()
    const buffer = this.term.buffer.active
    const view = {
      top: buffer.viewportY,
      bottom: buffer.viewportY >= buffer.baseY,
      screen: this.term.rows
    }
    const row = promptTarget(promptRows(this.bufferLines()), view, dir)
    if (row === null) {
      if (dir > 0) this.term.scrollToBottom()
      return
    }
    this.term.scrollToLine(row)
    // Markers are placed relative to the cursor's line.
    const marker = this.term.registerMarker(row - (buffer.baseY + buffer.cursorY))
    if (!marker) return
    this.term.registerDecoration({
      marker,
      width: this.term.cols,
      backgroundColor: promptFlashColor(this.theme)
    })
    setTimeout(() => marker.dispose(), PROMPT_FLASH_MS)
  }

  /**
   * Pastes text into the prompt without sending it, so you can add to it. A Claude that is still
   * starting (or not started yet) gets it once it is ready.
   */
  deliver(text: string): void {
    this.pending.push(text)
    if (this.sessionId && this.ready) this.flushPending()
    else {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = setTimeout(() => this.flushPending(), PENDING_MAX_MS)
    }
  }

  private flushPending(): void {
    clearTimeout(this.pendingTimer)
    if (!this.sessionId || this.pending.length === 0) return
    this.term.paste(this.pending.join('\n'))
    this.pending = []
    if (this.submitPending) {
      this.submitPending = false
      setTimeout(() => this.send('\r'), SUBMIT_DELAY_MS)
    }
    if (this.looking()) this.focus()
  }

  /** Claude's paste-image key: it takes the image on the clipboard into its prompt. */
  pasteImage(): void {
    this.send(imagePasteSequence(this.opts.platform))
    this.focus()
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
      shownSize = { cols: this.term.cols, rows: this.term.rows }
    } catch {
      // Renderer not ready yet (e.g. font still loading); the next resize will fit.
    }
  }

  focus(): void {
    this.term.focus()
  }

  /**
   * Font size and theme; `seeThrough`: a picture lies behind the terminal, so it draws its text
   * on a see-through background.
   */
  setAppearance(fontSize: number, theme: ITheme, seeThrough = false): void {
    if (this.term.options.fontSize !== fontSize) this.term.options.fontSize = fontSize
    if (this.theme !== theme || this.seeThrough !== seeThrough) {
      if (this.seeThrough !== seeThrough) {
        this.seeThrough = seeThrough
        this.term.options.allowTransparency = seeThrough
        // The GPU renderer reads that only as it starts.
        if (this.webgl) {
          this.webgl.dispose()
          this.loadWebgl()
        }
      }
      this.theme = theme
      this.term.options.minimumContrastRatio = minimumContrastFor(theme)
      // Same colour, fully transparent: text contrast is still judged against it.
      this.term.options.theme = seeThrough
        ? { ...theme, background: `${theme.background ?? '#000000'}00` }
        : theme
    }
    this.fit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.fitFrame)
    clearTimeout(this.resizeTimer)
    clearTimeout(this.settleTimer)
    clearTimeout(this.pendingTimer)
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
      webgl.onContextLoss(() => {
        webgl.dispose()
        if (this.webgl === webgl) this.webgl = null
      })
      this.term.loadAddon(webgl)
      this.webgl = webgl
    } catch {
      // WebGL unavailable: xterm keeps using its DOM renderer.
      this.webgl = null
    }
  }

  /** Like VS Code, links follow on Ctrl+click (Cmd+click on macOS); a plain click stays put. */
  private followsLink(e: MouseEvent): boolean {
    return this.opts.platform === 'darwin' ? e.metaKey : e.ctrlKey
  }

  /** The tooltip while the mouse is on a link: what Ctrl+click does. */
  private hintLink(action: string | null): void {
    const key = this.opts.platform === 'darwin' ? '⌘' : 'Ctrl'
    if (action) this.element.title = `${action} (${key} + click)`
    else this.element.removeAttribute('title')
  }

  /** Paths on buffer row `y` (1-based) and the rows it wraps onto that exist, as links. */
  private async fileLinks(y: number): Promise<ILink[] | undefined> {
    const cwd = useStore.getState().terminals[this.key]?.cwd
    const line = logicalLine(this.term.buffer.active, y - 1)
    const matches = findPaths(line.text).slice(0, MAX_FILE_LINKS)
    if (!cwd || !matches.length) return undefined
    const found = await window.api.resolveFileLinks(
      cwd,
      matches.map((m) => m.path)
    )
    const links = matches.flatMap((m, i): ILink[] => {
      const link = found[i]
      if (!link) return []
      const [from, to] = [line.cells[m.start], line.cells[m.end - 1]]
      return [
        {
          range: { start: { x: from.x + 1, y: from.y + 1 }, end: { x: to.x + 1, y: to.y + 1 } },
          text: line.text.slice(m.start, m.end),
          activate: (e) => {
            if (this.followsLink(e)) window.api.openFileLink(link.path)
          },
          hover: () => this.hintLink(FILE_LINK_ACTION[link.kind]),
          leave: () => this.hintLink(null)
        }
      ]
    })
    return links.length ? links : undefined
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
    if (this.bookmarkHotkey(ev)) return false
    const action = classifyKey(ev, this.opts.platform, this.term.hasSelection())
    if (action.type === 'pass') return true
    // Prompts are Claude's; a shell keeps Ctrl+arrows for itself.
    const promptJump = action.type === 'prevPrompt' || action.type === 'nextPrompt'
    if (promptJump && !this.isClaude()) return true
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
        this.send(NEWLINE_SEQUENCE)
        break
      case 'search':
        void this.openSearch()
        break
      case 'prevPrompt':
      case 'nextPrompt':
        void this.jumpToPrompt(action.type === 'prevPrompt' ? -1 : 1)
        break
      default:
        this.opts.onShortcut(action)
    }
    return false
  }

  /**
   * A bookmarked prompt's hotkey puts the prompt in, unsent (its keypress and keyup are blocked
   * too). With text selected, a hotkey on the copy key still copies.
   */
  private bookmarkHotkey(ev: KeyboardEvent): boolean {
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !/^F\d+$/.test(ev.code)) return false
    const hotkey = hotkeyOf(ev)
    const prompt = hotkey ? promptForHotkey(useStore.getState().bookmarks, hotkey) : null
    if (!prompt) return false
    if (this.term.hasSelection()) {
      const press = {
        type: 'keydown',
        key: ev.key,
        code: ev.code,
        ctrlKey: ev.ctrlKey,
        shiftKey: ev.shiftKey,
        altKey: ev.altKey,
        metaKey: ev.metaKey
      }
      if (classifyKey(press, this.opts.platform, true).type === 'copy') return false
    }
    if (ev.type === 'keydown') {
      ev.preventDefault()
      this.deliver(prompt.text)
    }
    return true
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
    const t = useStore.getState().terminals[this.key]
    const choice = await window.api.contextMenu({
      hasSelection: this.term.hasSelection(),
      canSnip: t?.spec.kind === 'claude' && t.status === 'running',
      targets: this.opts.sendTargets(this.key)
    })
    if (choice === 'copy') this.copySelection()
    else if (choice === 'paste') await this.paste()
    else if (choice === 'selectAll') this.term.selectAll()
    else if (choice === 'snip') return this.opts.onSnip(this.key)
    else if (choice && typeof choice === 'object' && 'pasteBookmark' in choice) {
      const bookmark = findNode(useStore.getState().bookmarks, choice.pasteBookmark)
      if (bookmark?.type === 'prompt') this.term.paste(bookmark.text)
    } else if (choice) {
      // Bookmarking or Send To. No selection: a fullscreen Claude has copied what you dragged
      // over to the clipboard.
      const text = this.term.getSelection() || (await window.api.readClipboard()).text
      if (choice === 'bookmark') {
        if (text.trim()) return this.opts.onBookmark(text)
      } else if (text) return this.opts.onSend(choice.sendTo, text)
    }
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
