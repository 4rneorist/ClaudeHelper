export const DEFAULT_FONT_SIZE = 14

export const MODE_LABELS = {
  new: 'New conversation',
  continue: 'Continue last',
  resume: 'Resume…'
} as const

export const INSTALL_HINTS: Record<string, string> = {
  win32: 'irm https://claude.ai/install.ps1 | iex',
  darwin: 'curl -fsSL https://claude.ai/install.sh | bash',
  linux: 'curl -fsSL https://claude.ai/install.sh | bash'
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", or a date for anything older than a week. */
export function formatAgo(epochMs: number, now = Date.now()): string {
  const minutes = Math.floor((now - epochMs) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(epochMs).toLocaleDateString()
}
