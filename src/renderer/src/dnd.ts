import { useStore, type DragPayload } from './store'
import { DND_MIME } from './terminal/TerminalSession'

export function startDrag(e: React.DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
  // Changing the DOM inside dragstart can cancel the drag in Chromium; show drop zones next tick.
  setTimeout(() => useStore.getState().setDrag(payload), 0)
}

export function endDrag(): void {
  useStore.getState().setDrag(null)
}
