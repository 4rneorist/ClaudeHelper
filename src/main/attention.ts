import { Notification, type BrowserWindow } from 'electron'
import icon from '../../resources/icon.png?asset'
import type { AttentionRequest } from '../shared/ipc'

// Electron drops a notification's click handler once the object is garbage-collected.
const shown = new Set<Notification>()

/**
 * A session stopped and waits for the user: flash the taskbar button and show an OS
 * notification, but only while the window is in the background (inside it, a toast shows it).
 */
export function notifyAttention(
  win: BrowserWindow,
  req: AttentionRequest,
  onClick: (key: string) => void
): void {
  if (win.isDestroyed() || win.isFocused()) return
  win.flashFrame(true)
  win.once('focus', () => win.flashFrame(false))
  if (!Notification.isSupported()) return
  // The app's own icon, so it is clear where the notification comes from.
  const notification = new Notification({ title: req.title, body: req.body, icon })
  shown.add(notification)
  const forget = (): void => void shown.delete(notification)
  notification.on('click', () => {
    forget()
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    onClick(req.key)
  })
  notification.on('close', forget)
  notification.show()
}
