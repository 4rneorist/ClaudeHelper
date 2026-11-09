/**
 * What the "Claude Code" window manages: skills, commands, agents, output styles, hooks, memory
 * files, permissions and settings in your user folder (~/.claude, for every project) or in one
 * project's folder; MCP servers, plugins and marketplaces through Claude Code's CLI; and your
 * keybindings.
 */

/** Markdown files with frontmatter, one per item. */
export type ItemKind = 'skill' | 'agent' | 'command' | 'outputStyle'
export const ITEM_KINDS: readonly ItemKind[] = ['skill', 'agent', 'command', 'outputStyle']
/** Your own Claude folder (every project), or one project's .claude folder. */
export type ItemScope = 'user' | 'project'
/** Hooks also live in the project's settings.local.json, which is yours and not committed. */
export type HookScope = 'user' | 'project' | 'local'
export type PluginScope = 'user' | 'project' | 'local'

export const ITEM_SCOPES: readonly ItemScope[] = ['user', 'project']
export const HOOK_SCOPES: readonly HookScope[] = ['user', 'project', 'local']
export const PLUGIN_SCOPES: readonly PluginScope[] = ['user', 'project', 'local']

/**
 * A new skill or agent's name: lowercase letters, digits and hyphens (a skill's name is its
 * /command). Existing ones keep whatever name they have.
 */
export const ITEM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_ITEM_NAME = 64
/** A skill's SKILL.md or an agent's file. */
export const MAX_ITEM_TEXT = 1024 * 1024

export interface ClaudeItemRef {
  kind: ItemKind
  scope: ItemScope
  /** The project folder, for scope 'project'. */
  folder?: string
  /** A skill's folder name; an agent's file name without .md ("team/reviewer" in a subfolder). */
  name: string
}

export interface ClaudeItem extends ClaudeItemRef {
  /** The SKILL.md or agent file. */
  path: string
  description: string
  /** The name in its frontmatter, when it has one (an output style is chosen by it). */
  title?: string
  /** What is wrong with the file, so Claude Code may skip it. */
  problem?: string
}

export interface ClaudeItemList {
  items: ClaudeItem[]
  /** Where new ones go: the user's and the project's skills or agents folder. */
  userDir: string
  projectDir: string | null
}

export interface SaveItemRequest {
  ref: ClaudeItemRef
  text: string
  /** The name it had when opened: renamed when it differs; absent for a new one. */
  from?: string
}

export type ConfigResult = { ok: true } | { ok: false; error: string }

/** One hook handler as it is written in settings: `type` plus its own fields. */
export type HookHandler = { type: string } & Record<string, unknown>

export interface HookEntry {
  scope: HookScope
  event: string
  /** '' when the group has none (it then runs for everything). */
  matcher: string
  /** Where it is, so it can be found again: the event's group and the handler in it. */
  group: number
  index: number
  handler: HookHandler
}

export interface HookFile {
  scope: HookScope
  path: string
  /** The file can't be read as settings; it is then left alone. */
  error?: string
  hooks: HookEntry[]
}

export interface HookChange {
  folder?: string
  scope: HookScope
  event: string
  matcher: string
  handler: HookHandler
  /** The hook being changed (it is replaced, or moved); absent for a new one. */
  original?: HookEntry
}

export interface HookDeleteRequest {
  folder?: string
  entry: HookEntry
}

export const HOOK_TYPES = ['command', 'prompt', 'agent', 'http', 'mcp_tool'] as const

export interface HookEvent {
  name: string
  when: string
  /** What its matcher matches; absent when the event has no matcher. */
  matcher?: string
}

/** Claude Code's hook events (2.1.3xx), in the order a session meets them. */
export const HOOK_EVENTS: readonly HookEvent[] = [
  {
    name: 'SessionStart',
    when: 'A session starts or resumes',
    matcher: 'startup, resume, clear, compact or fork'
  },
  { name: 'Setup', when: 'Claude Code runs its setup', matcher: 'init or maintenance' },
  {
    name: 'InstructionsLoaded',
    when: 'A CLAUDE.md or rules file is loaded',
    matcher: 'Why it was loaded'
  },
  { name: 'UserPromptSubmit', when: 'You send a prompt, before Claude sees it' },
  {
    name: 'UserPromptExpansion',
    when: 'A /command or skill turns into a prompt',
    matcher: 'The command or skill name'
  },
  {
    name: 'PreToolUse',
    when: 'Before a tool runs; it can block it',
    matcher: 'Tool name, e.g. Bash or Edit|Write'
  },
  {
    name: 'PermissionRequest',
    when: 'Claude Code asks you to allow a tool',
    matcher: 'Tool name, e.g. Bash'
  },
  {
    name: 'PermissionDenied',
    when: 'A tool call was not allowed',
    matcher: 'Tool name, e.g. Bash'
  },
  { name: 'PostToolUse', when: 'After a tool succeeds', matcher: 'Tool name, e.g. Edit|Write' },
  { name: 'PostToolUseFailure', when: 'After a tool fails', matcher: 'Tool name, e.g. Bash' },
  { name: 'PostToolBatch', when: 'After a batch of tool calls' },
  {
    name: 'Notification',
    when: 'Claude Code notifies you, e.g. it waits for you',
    matcher: 'permission_prompt, idle_prompt, auth_success, …'
  },
  { name: 'MessageDisplay', when: 'A message is shown' },
  { name: 'SubagentStart', when: 'An agent starts', matcher: 'Agent type' },
  { name: 'SubagentStop', when: 'An agent finishes', matcher: 'Agent type' },
  { name: 'TaskCreated', when: 'A task is created' },
  { name: 'TaskCompleted', when: 'A task is completed' },
  { name: 'Stop', when: 'Claude finishes its reply' },
  { name: 'StopFailure', when: 'A reply ends with an error', matcher: 'Error type' },
  { name: 'TeammateIdle', when: 'A teammate in an agent team goes idle' },
  {
    name: 'ConfigChange',
    when: 'Settings or skills change during the session',
    matcher: 'user_settings, project_settings, local_settings, policy_settings or skills'
  },
  { name: 'CwdChanged', when: 'The working folder changes' },
  {
    name: 'DirectoryAdded',
    when: 'A folder is added to the session',
    matcher: 'slash_command or register_repo_root'
  },
  { name: 'FileChanged', when: 'A watched file changes', matcher: 'File names, e.g. .env|.envrc' },
  { name: 'WorktreeCreate', when: 'A git worktree is created' },
  { name: 'WorktreeRemove', when: 'A git worktree is removed' },
  { name: 'PreCompact', when: 'Before the conversation is compacted', matcher: 'manual or auto' },
  { name: 'PostCompact', when: 'After the conversation is compacted', matcher: 'manual or auto' },
  { name: 'PreModelSwitch', when: 'Before the model changes', matcher: 'Model name' },
  { name: 'PostModelSwitch', when: 'After the model changes', matcher: 'Model name' },
  { name: 'Elicitation', when: 'An MCP server asks you for input', matcher: 'MCP server name' },
  { name: 'ElicitationResult', when: 'You answered an MCP server', matcher: 'MCP server name' },
  {
    name: 'SessionEnd',
    when: 'A session ends',
    matcher: 'clear, resume, logout, prompt_input_exit or other'
  }
]

/** JSON with its keys sorted, to tell whether two handlers are the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export const sameJson = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b)

export const HOOK_EVENT = /^[A-Z][A-Za-z]{1,39}$/
export const MAX_MATCHER = 500
export const MAX_HOOK_JSON = 100 * 1024

export const AGENT_MODELS = ['sonnet', 'opus', 'haiku', 'fable', 'inherit'] as const
export const AGENT_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan'
] as const

/** A plugin installed in one scope (the same plugin can be in several). */
export interface InstalledPlugin {
  id: string
  version?: string
  /** user, project or local; also synced (claude.ai) or managed, which can't be changed here. */
  scope: string
  /** Enabled for the folder it was asked about. */
  enabled: boolean
  /** The project it belongs to, for scopes project and local. */
  projectPath?: string
  errors: string[]
  mcpServers: string[]
}

export interface AvailablePlugin {
  id: string
  name: string
  description: string
  marketplace: string
  version?: string
  installCount?: number
  /** Its web page or repository, when the marketplace says where it comes from. */
  url?: string
}

export type PluginList =
  | { ok: true; installed: InstalledPlugin[]; available: AvailablePlugin[] }
  | { ok: false; error: string }

export type PluginAction = 'install' | 'uninstall' | 'enable' | 'disable' | 'update'
export const PLUGIN_ACTIONS: readonly PluginAction[] = [
  'install',
  'uninstall',
  'enable',
  'disable',
  'update'
]
/** name or name@marketplace. */
export const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/

export interface PluginActionRequest {
  action: PluginAction
  id: string
  scope: PluginScope
  /** The project, for scopes project and local. */
  folder?: string
  /** The command a marketplace runs to install it, which you agreed to (its sha256). */
  acceptCommand?: string
}

export type PluginActionResult =
  | { ok: true; message: string }
  | {
      ok: false
      error: string
      /** The marketplace installs it by running this command: run it only once you agree. */
      confirm?: { command: string; sha256: string }
    }

// ---- memory files: CLAUDE.md, rules, and the notes Claude keeps ----

/**
 * user        <claude folder>/CLAUDE.md
 * userRule    <claude folder>/rules/<name>.md
 * project     <folder>/CLAUDE.md
 * projectDot  <folder>/.claude/CLAUDE.md
 * local       <folder>/CLAUDE.local.md (yours, not committed)
 * projectRule <folder>/.claude/rules/<name>.md
 * note        <claude folder>/projects/<folder as a name>/memory/<name>.md (Claude writes these)
 */
export type MemoryArea =
  'user' | 'userRule' | 'project' | 'projectDot' | 'local' | 'projectRule' | 'note'
export const MEMORY_AREAS: readonly MemoryArea[] = [
  'user',
  'userRule',
  'project',
  'projectDot',
  'local',
  'projectRule',
  'note'
]
/** Areas with many files, each with a name. */
export const NAMED_AREAS: readonly MemoryArea[] = ['userRule', 'projectRule', 'note']

export interface MemoryRef {
  area: MemoryArea
  folder?: string
  /** For rules and notes: the file name without .md (rules may sit in subfolders). */
  name?: string
}

export interface MemoryFile extends MemoryRef {
  path: string
  /** Not there yet: saving it creates it. */
  exists: boolean
}

export interface SaveMemoryRequest {
  ref: MemoryRef
  text: string
  /** The name it had when opened (a rule can be renamed); absent for a new one. */
  from?: string
  /** The text as it was read, so a change made meanwhile isn't overwritten; null when new. */
  before: string | null
}

// ---- MCP servers ----

export type McpScope = 'user' | 'project' | 'local'
export const MCP_SCOPES: readonly McpScope[] = ['user', 'project', 'local']
export const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export interface McpServer {
  name: string
  scope: McpScope
  /** As it is written: command/args/env, or type/url/headers, and so on. */
  config: Record<string, unknown>
}

export interface McpList {
  servers: McpServer[]
  /** Where each scope keeps them, to show. */
  files: Record<McpScope, string | null>
  error?: string
}

export interface McpSaveRequest {
  folder?: string
  scope: McpScope
  name: string
  config: Record<string, unknown>
  /** The server being changed; absent for a new one. */
  original?: { name: string; scope: McpScope }
}

export interface McpRemoveRequest {
  folder?: string
  scope: McpScope
  name: string
}

export type McpState = 'connected' | 'auth' | 'failed' | 'pending' | 'other'

/**
 * A server as `claude mcp list` reports it, after trying to connect: also the claude.ai
 * connectors and the plugins' servers, which aren't in the files.
 */
export interface McpStatus {
  /** As Claude Code names it: "github", "claude.ai Gmail", "plugin:context7:context7". */
  name: string
  /** Where it comes from: your settings, your claude.ai account, or a plugin. */
  source: 'config' | 'claude.ai' | 'plugin'
  /** Its URL, or its command line. */
  target: string
  state: McpState
  /** What Claude Code says about it: "Connected", "Needs authentication"… */
  text: string
}

export type McpStatusList = { ok: true; servers: McpStatus[] } | { ok: false; error: string }

// ---- settings files: permissions, model, output style, environment, status line ----

/** The settings this window edits; everything else in the file stays as it is. */
export const SETTINGS_KEYS = ['permissions', 'model', 'outputStyle', 'env', 'statusLine'] as const
export type SettingsKey = (typeof SETTINGS_KEYS)[number]

export interface SettingsFile {
  scope: HookScope
  path: string
  error?: string
  /** Only the keys above, as they are in the file. */
  values: Partial<Record<SettingsKey, unknown>>
}

export interface SettingsPatch {
  folder?: string
  scope: HookScope
  /** New values; null removes the setting. */
  set: Partial<Record<SettingsKey, unknown>>
  /** The same keys as they were read (null for absent): refused if they changed meanwhile. */
  before: Partial<Record<SettingsKey, unknown>>
}

export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions'
] as const
export const PERMISSION_LISTS = ['allow', 'ask', 'deny'] as const
export const MAX_RULES = 1000
export const MAX_RULE = 2000
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

// ---- marketplaces ----

export interface Marketplace {
  name: string
  /** Where it comes from, as `claude plugin marketplace add` takes it. */
  source: string
  installLocation?: string
  url?: string
}

export type MarketplaceList = { ok: true; items: Marketplace[] } | { ok: false; error: string }

export type MarketplaceAction = 'add' | 'remove' | 'update'

export interface MarketplaceRequest {
  action: MarketplaceAction
  /** The source for add (owner/repo, a git or https URL, or a path); the name otherwise. */
  target: string
  /** For add: which settings declare it. */
  scope?: PluginScope
  folder?: string
}

/** A marketplace name, or a source: owner/repo, a URL or a path (no quotes or line breaks). */
export const MARKETPLACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const MAX_SOURCE = 500

// ---- keybindings ----

export interface KeybindingsFile {
  path: string
  /** The file as it is; null when there is none yet. */
  text: string | null
  error?: string
}

export interface KeybindingsSave {
  text: string
  /** The text as it was read, so a change made meanwhile isn't overwritten. */
  before: string | null
}

export const MAX_SETTINGS_TEXT = 1024 * 1024

/** How deep in subfolders items may sit (a skill is a folder of its own). */
export const ITEM_DEPTH: Record<ItemKind, number> = {
  skill: 1,
  agent: 3,
  command: 3,
  outputStyle: 1
}

/** A name a new (or renamed) item can get: lowercase words, maybe in subfolders ("team/review"). */
export function isNewName(name: string, depth: number): boolean {
  const parts = name.split('/')
  return parts.length <= depth && parts.every((p) => p.length <= MAX_ITEM_NAME && ITEM_NAME.test(p))
}

// ---- from elsewhere: claude.ai and plugins (shown, not changed) ----

/** A skill, command, agent or output style that comes from claude.ai or a plugin. */
export interface ReadOnlyItem {
  kind: ItemKind
  source: 'claude.ai' | 'plugin'
  /** The plugin's name, for one that comes with a plugin. */
  plugin?: string
  name: string
  description: string
  path: string
  text: string
}

export interface ReadOnlyHook {
  plugin: string
  event: string
  matcher: string
  handler: HookHandler
  /** The file it is written in. */
  path: string
}

export interface ExtrasList {
  items: ReadOnlyItem[]
  hooks: ReadOnlyHook[]
  /** Why plugins couldn't be asked about (the claude.ai skills are still there). */
  error?: string
}

// ---- your account and your organization ----

/** `claude auth status`. */
export interface AuthStatus {
  loggedIn: boolean
  authMethod?: string
  email?: string
  orgName?: string
  subscriptionType?: string
  loginExpiresAt?: string
  apiProvider?: string
}

export type AuthResult = { ok: true; status: AuthStatus } | { ok: false; error: string }

export interface OrgPolicies {
  /** What your organization allows or not, by Claude Code's name for it. */
  restrictions: { key: string; allowed: boolean }[]
  defaults: Record<string, unknown>
  monitoringNotice: string | null
  complianceTaints: string[]
  /** Settings your organization sends to Claude Code; null when it sends none. */
  remoteSettings: Record<string, unknown> | null
  /** An administrator's settings file on this computer. */
  managedSettings: { path: string; data: Record<string, unknown> } | null
  /** When the organization's settings were last fetched (epoch ms). */
  syncedAt?: number
  /** Claude Code has fetched your organization's rules at all. */
  known: boolean
}

/** A terminal tab that runs `claude auth login` (as a shell, so it is not a conversation). */
export const CLAUDE_LOGIN_SHELL = 'claude-login'
