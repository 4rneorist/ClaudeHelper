import { useStore } from './store'

// Keeps each open folder's git branch and uncommitted-changes mark current for the folder tabs
// and the status bar. Claude edits and commits all the time, so this polls; git runs in main.

const POLL_MS = 5000

let started = false
/** Folders whose last check hasn't answered yet; a slow repository isn't asked twice. */
const pending = new Set<string>()

function refresh(): void {
  const folders = new Set(useStore.getState().workspaces.flatMap((w) => (w.cwd ? [w.cwd] : [])))
  for (const cwd of folders) {
    if (pending.has(cwd)) continue
    pending.add(cwd)
    void window.api
      .gitInfo(cwd)
      .then((info) => useStore.getState().setGitInfo(cwd, info))
      .finally(() => pending.delete(cwd))
  }
}

export function startGitPolling(): void {
  if (started) return
  started = true
  refresh()
  setInterval(refresh, POLL_MS)
  window.addEventListener('focus', refresh)
  // A folder that just opened shouldn't wait for the next round.
  useStore.subscribe((state, prev) => {
    if (state.workspaces === prev.workspaces) return
    if (state.workspaces.some((w) => w.cwd && !(w.cwd in state.gitInfo))) refresh()
  })
}
