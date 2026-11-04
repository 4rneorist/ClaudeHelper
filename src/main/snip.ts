import { execFile } from 'child_process'
import { clipboard, shell, type BrowserWindow } from 'electron'
import type { SnipResult } from '../shared/ipc'

/** How long a snip may take before it counts as abandoned. */
const SNIP_TIMEOUT_MS = 2 * 60 * 1000
const POLL_MS = 300

/**
 * Region pickers on Linux that put the picked image on the clipboard, tried in order. Each
 * returns once the region is picked (or the pick is cancelled).
 */
export const LINUX_SNIP_TOOLS: ReadonlyArray<{ file: string; args: string[] }> = [
  { file: 'gnome-screenshot', args: ['--area', '--clipboard'] },
  { file: 'spectacle', args: ['--region', '--background', '--nonotify', '--copy-image'] },
  { file: 'flameshot', args: ['gui', '--clipboard'] }
]

const hasImage = (): Promise<boolean> => clipboard.has('image/png').catch(() => false)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Runs a program to its end; false if it can't be started (not installed). */
function run(file: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: SNIP_TIMEOUT_MS }, (error) =>
      resolve(!(error && (error as NodeJS.ErrnoException).code === 'ENOENT'))
    )
  })
}

/**
 * Windows: the Snipping Tool overlay (ms-screenclip:) copies the picked region to the clipboard
 * but doesn't say when it is done, so the clipboard is watched for the image. Bringing the
 * window back yourself means the snip was cancelled.
 */
function snipWindows(win: BrowserWindow): Promise<SnipResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    let done = false
    const finish = (result: SnipResult): void => {
      if (done) return
      done = true
      clearInterval(timer)
      win.off('focus', onFocus)
      resolve(result)
    }
    const onFocus = (): void => {
      if (Date.now() - started > 1000) finish('cancelled')
    }
    const timer = setInterval(() => {
      if (Date.now() - started > SNIP_TIMEOUT_MS) finish('cancelled')
      else void hasImage().then((yes) => yes && finish('captured'))
    }, POLL_MS)
    win.on('focus', onFocus)
    shell.openExternal('ms-screenclip:').catch(() => finish('unavailable'))
  })
}

/** macOS and Linux: a picker that ends when the region is picked or the pick is cancelled. */
async function snipWithTool(
  tools: ReadonlyArray<{ file: string; args: string[] }>
): Promise<SnipResult> {
  for (const tool of tools) {
    if (!(await run(tool.file, tool.args))) continue
    // Some tools hand the image to the clipboard just after they exit.
    for (let waited = 0; waited < 2000; waited += POLL_MS) {
      if (await hasImage()) return 'captured'
      await sleep(POLL_MS)
    }
    return 'cancelled'
  }
  return 'unavailable'
}

/**
 * Lets you pick a region of the screen with the system's own tool and leaves the image on the
 * clipboard. The app's window steps aside meanwhile, so what is behind it can be picked. The
 * clipboard is emptied first, so the image is recognised when it arrives; a cancelled snip
 * puts back what was there.
 */
export async function snipToClipboard(
  win: BrowserWindow,
  platform: NodeJS.Platform
): Promise<SnipResult> {
  const saved = await clipboard.read().catch(() => [])
  clipboard.clear()
  win.minimize()
  let result: SnipResult = 'cancelled'
  try {
    if (platform === 'win32') result = await snipWindows(win)
    else if (platform === 'darwin') {
      result = await snipWithTool([{ file: 'screencapture', args: ['-i', '-c'] }])
    } else result = await snipWithTool(LINUX_SNIP_TOOLS)
    return result
  } finally {
    if (result !== 'captured' && saved.length > 0) await clipboard.write(saved).catch(() => {})
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}
