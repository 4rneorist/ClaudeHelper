/**
 * Claude Code's keybinding contexts and the actions each one has (code.claude.com/docs/en/keybindings,
 * Claude Code 2.1.3xx), for suggestions in the keybindings editor. Other names still save.
 */

const SELECT = [
  'select:next',
  'select:previous',
  'select:pageUp',
  'select:pageDown',
  'select:first',
  'select:last',
  'select:accept',
  'select:cancel'
]
const SCROLL = [
  'scroll:lineUp',
  'scroll:lineDown',
  'scroll:pageUp',
  'scroll:pageDown',
  'scroll:top',
  'scroll:bottom',
  'scroll:halfPageUp',
  'scroll:halfPageDown',
  'scroll:fullPageUp',
  'scroll:fullPageDown'
]
const ABOVE_PROMPT = [
  'abovePrompt:next',
  'abovePrompt:previous',
  'abovePrompt:press',
  'abovePrompt:leave',
  'abovePrompt:highlightNext',
  'abovePrompt:highlightPrevious'
]
const PANE = [
  'pane:scrollUp',
  'pane:scrollDown',
  'pane:pageUp',
  'pane:pageDown',
  'pane:top',
  'pane:bottom',
  'pane:grow',
  'pane:shrink',
  'pane:close'
]
const HISTORY = ['history:search', 'history:previous', 'history:next']

export const KEYBINDING_CONTEXTS: Record<string, string[]> = {
  Global: [
    'app:interrupt',
    'app:exit',
    'app:redraw',
    'app:toggleTodos',
    'app:toggleTranscript',
    'app:toggleReplTab',
    'app:diffFileListUp',
    'app:diffFileListDown',
    'app:toggleDiffNoiseFilter',
    'app:toggleDiffPreSession',
    'pane:next',
    'pane:previous',
    ...HISTORY
  ],
  Chat: [
    'chat:cancel',
    'chat:clearInput',
    'chat:clearScreen',
    'chat:killAgents',
    'chat:cycleMode',
    'chat:modelPicker',
    'chat:fastMode',
    'chat:thinkingToggle',
    'chat:submit',
    'chat:queueSubmit',
    'chat:sendNow',
    'chat:newline',
    'chat:undo',
    'chat:externalEditor',
    'chat:stash',
    'chat:imagePaste',
    'abovePrompt:toggle',
    'abovePrompt:focus',
    'voice:pushToTalk',
    ...HISTORY,
    'command:compact'
  ],
  Autocomplete: [
    'autocomplete:accept',
    'autocomplete:dismiss',
    'autocomplete:previous',
    'autocomplete:next'
  ],
  Confirmation: [
    'confirm:yes',
    'confirm:no',
    'confirm:previous',
    'confirm:next',
    'confirm:nextField',
    'confirm:toggle',
    'confirm:cycleMode'
  ],
  Settings: [
    'settings:search',
    'settings:retry',
    'settings:fixUsage',
    'select:accept',
    'confirm:no'
  ],
  Tabs: ['tabs:next', 'tabs:previous'],
  Help: ['help:dismiss'],
  Transcript: ['transcript:toggleShowAll', 'transcript:exit'],
  HistorySearch: [
    'historySearch:next',
    'historySearch:accept',
    'historySearch:cancel',
    'historySearch:execute',
    'historySearch:cycleScope'
  ],
  Task: ['task:background'],
  ThemePicker: ['theme:toggleSyntaxHighlighting'],
  Attachments: [
    'attachments:next',
    'attachments:previous',
    'attachments:remove',
    'attachments:exit'
  ],
  Footer: [
    'footer:next',
    'footer:previous',
    'footer:up',
    'footer:down',
    'footer:openSelected',
    'footer:clearSelection',
    'footer:close'
  ],
  MessageSelector: SELECT,
  DiffDialog: [
    'diff:dismiss',
    'diff:previousSource',
    'diff:nextSource',
    'diff:previousFile',
    'diff:nextFile',
    'diff:back',
    ...SCROLL,
    ...SELECT
  ],
  DiffPanel: ['app:cycleDiffBase'],
  ModelPicker: [
    'modelPicker:decreaseEffort',
    'modelPicker:increaseEffort',
    'modelPicker:thisSessionOnly'
  ],
  EffortSlider: [
    'effortSlider:decreaseEffort',
    'effortSlider:increaseEffort',
    'effortSlider:toggleUltracode',
    'effortSlider:thisSessionOnly'
  ],
  Select: SELECT,
  Plugin: ['plugin:toggle', 'plugin:install', 'plugin:favorite'],
  AbovePrompt: [...ABOVE_PROMPT, ...PANE.slice(0, 6)],
  AbovePromptInput: ABOVE_PROMPT,
  AbovePromptSelect: ABOVE_PROMPT,
  Pane: [...PANE, ...ABOVE_PROMPT],
  PaneField: ['pane:close'],
  Agents: [
    'agents:switchView',
    'agents:togglePin',
    'agents:find',
    'agents:rename',
    'agents:previousGroup',
    'agents:nextGroup'
  ],
  Scroll: [
    ...SCROLL,
    'selection:copy',
    'selection:clear',
    'selection:extendLeft',
    'selection:extendRight',
    'selection:extendUp',
    'selection:extendDown',
    'selection:extendLineStart',
    'selection:extendLineEnd'
  ]
}

/** Keys Claude Code can't rebind. */
export const RESERVED_KEYS = ['ctrl+c', 'ctrl+d', 'ctrl+m', 'ctrl+[', 'ctrl+i', 'ctrl+h']

export interface BindingRow {
  context: string
  key: string
  /** null unbinds the key. */
  action: string | null
}

export interface ParsedBindings {
  rows: BindingRow[]
  /** What else the file has ($schema, $docs…), kept as it is. */
  extra: Record<string, unknown>
}

/** The rows of a keybindings file; null when it isn't one this editor can show. */
export function parseBindings(text: string | null): ParsedBindings | null {
  if (text === null || !text.trim()) return { rows: [], extra: {} }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { bindings, ...extra } = data as Record<string, unknown>
  if (bindings !== undefined && !Array.isArray(bindings)) return null
  const rows: BindingRow[] = []
  for (const block of (bindings as unknown[] | undefined) ?? []) {
    if (!block || typeof block !== 'object') return null
    const { context, bindings: map } = block as Record<string, unknown>
    if (typeof context !== 'string' || !map || typeof map !== 'object' || Array.isArray(map)) {
      return null
    }
    for (const [key, action] of Object.entries(map)) {
      if (action !== null && typeof action !== 'string') return null
      rows.push({ context, key, action })
    }
  }
  return { rows, extra }
}

/** The file for these rows: one block per context, in the order they first appear. */
export function bindingsText(parsed: ParsedBindings): string {
  const blocks = new Map<string, Record<string, string | null>>()
  for (const row of parsed.rows) {
    const key = row.key.trim()
    if (!row.context || !key) continue
    if (!blocks.has(row.context)) blocks.set(row.context, {})
    blocks.get(row.context)![key] = row.action
  }
  const data = {
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    ...parsed.extra,
    bindings: [...blocks].map(([context, bindings]) => ({ context, bindings }))
  }
  return JSON.stringify(data, null, 2) + '\n'
}

/** What is wrong with a row, if anything: a reserved key, or the same key twice in a context. */
export function bindingProblem(rows: BindingRow[], index: number): string | null {
  const row = rows[index]
  const key = row.key.trim().toLowerCase()
  if (!key) return 'Give the key'
  if (/\+\s|\s\+/.test(key)) return 'No spaces next to +'
  if (RESERVED_KEYS.includes(key)) return 'Claude Code doesn’t let this key be changed'
  const twice = rows.findIndex(
    (r, i) => i !== index && r.context === row.context && r.key.trim().toLowerCase() === key
  )
  if (twice !== -1 && twice < index) return 'This key is already set in this context'
  if (row.action !== null && !row.action.trim()) return 'Give the action, or unbind the key'
  return null
}
