import { useStore, type DragPayload } from './store'
import { DND_MIME } from './terminal/TerminalSession'

export function startDrag(e: React.DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
  // Changing the DOM inside dragstart can cancel the drag in Chromium; show drop zones next tick.
  setTimeout(() => useStore.getState().setDrag(payload), 0)
}

/** Whether a pane or tab from this folder is being dragged; terminals stay in their folder. */
export function fromFolder(
  drag: DragPayload | null,
  workspace: string
): drag is Exclude<DragPayload, { kind: 'workspace' }> {
  return !!drag && drag.kind !== 'workspace' && drag.workspace === workspace
}

export function endDrag(): void {
  useStore.getState().setDrag(null)
}
