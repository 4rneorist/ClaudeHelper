// The Jira ticket a git branch is for ("bugfix/MT-25443_fix" → MT-25443), and its link.
// Pure, for unit tests.

/** A Jira key: project letters (and digits), a dash, a number; not inside a longer word. */
const JIRA_KEY = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]+-\d+)/

export function jiraKeyFromBranch(branch: string): string | null {
  return JIRA_KEY.exec(branch)?.[1] ?? null
}

/** The ticket's URL: the key goes where the template says {key}, or at its end. */
export function jiraLink(template: string, key: string): string | null {
  const url = template.trim()
  if (!url) return null
  return url.includes('{key}') ? url.replaceAll('{key}', key) : url + key
}
