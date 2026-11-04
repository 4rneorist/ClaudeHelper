import { jiraKeyFromBranch, jiraLink } from '../jira'
import { useStore } from '../store'

/** The Jira ticket a branch is for, as a link; nothing unless switched on in Settings. */
export function JiraChip({
  branch,
  className
}: {
  branch: string
  className: string
}): React.JSX.Element | null {
  const template = useStore((s) => (s.settings?.jiraEnabled ? s.settings.jiraUrl : ''))
  const key = jiraKeyFromBranch(branch)
  const link = key && jiraLink(template, key)
  if (!key || !link) return null
  return (
    <button
      type="button"
      className={className}
      title={`Open ${key} in Jira`}
      aria-label={`Open ${key} in Jira`}
      // Not a click on the tab: no selecting, dragging or popover.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        window.api.openExternal(link)
      }}
    >
      {key}
    </button>
  )
}
