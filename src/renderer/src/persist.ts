import { snapshot, useStore } from './store'

// Saves the open folders/tabs/splits so the next start can reopen them. Saving goes through main,
// which also reports the conversation each Claude tab has open now (it changes on /clear or
// /resume inside claude); those ids flow back into the store, so the next save records them.

const DEBOUNCE_MS = 250
/** Picks up conversation switches made inside claude even when the layout doesn't change. */
const REFRESH_MS = 30_000

let started = false

export function startPersistence(): void {
  if (started) return
  started = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastJson = JSON.stringify(snapshot(useStore.getState()))

  const save = async (): Promise<void> => {
    const ids = await window.api.saveUiState(snapshot(useStore.getState()))
    const { terminals, patchTerminal } = useStore.getState()
    for (const [key, id] of Object.entries(ids)) {
      if (terminals[key] && terminals[key].claudeSessionId !== id) {
        patchTerminal(key, { claudeSessionId: id })
      }
    }
  }

  useStore.subscribe((state, prev) => {
    if (
      state.workspaces === prev.workspaces &&
      state.activeWorkspace === prev.activeWorkspace &&
      state.terminals === prev.terminals
    ) {
      return
    }
    // Terminals change on every title update; only save when something persisted changed.
    const json = JSON.stringify(snapshot(state))
    if (json === lastJson) return
    lastJson = json
    clearTimeout(timer)
    timer = setTimeout(() => void save(), DEBOUNCE_MS)
  })
  setInterval(() => void save(), REFRESH_MS)
  // Before quitting, main wants the very latest layout (a pending debounced save would be lost).
  window.api.onUiFlushRequest(() => {
    clearTimeout(timer)
    void save()
  })
  // Last changes right before the window closes (the save request goes out synchronously).
  window.addEventListener('beforeunload', () => {
    clearTimeout(timer)
    void save()
  })
}
