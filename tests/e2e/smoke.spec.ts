import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { ClaudeHelperApi } from '../../src/shared/ipc'
import { fakeClaudeProcessCount } from './helpers'

// Runs the built app (out/) against a fake claude so the whole path
// renderer → IPC → node-pty/ConPTY → process → xterm is exercised without network or login.

test.describe.configure({ mode: 'serial' })

const root = path.resolve(__dirname, '../..')
const fixtures = path.join(__dirname, 'fixtures')
const fakeClaude = path.join(
  fixtures,
  process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude'
)
const PAST_SESSION = '0bcd6d6b-1111-4222-8333-444455556666'

let app: ElectronApplication
let page: Page
let tmp: string
let project: string
let other: string

const activeSubTab = (): Locator =>
  page.locator('.workspace-panel:not([hidden]) .subtab-panel:not([hidden])')
const activePane = (): Locator => activeSubTab().locator('.pane[data-active="true"]')
const subTabs = (): Locator => page.locator('.workspace-panel:not([hidden]) .subtab')

/** Visible terminal text of the active pane (the e2e build uses xterm's DOM renderer). */
async function terminalText(pane: Locator = activePane()): Promise<string> {
  return pane.locator('.xterm-rows').innerText()
}

async function waitForText(text: string, pane?: Locator): Promise<void> {
  await expect.poll(() => terminalText(pane), { timeout: 20_000 }).toContain(text)
}

/** HTML5 drag with pauses, so drop zones (rendered on dragstart) exist before the drop. */
async function drag(from: Locator, to: Locator, at?: { x: number; y: number }): Promise<void> {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 })
  // The app shows drop zones once it has registered the drag; don't move to the target before.
  await page
    .locator('.drop-zone')
    .first()
    .waitFor({ state: 'attached', timeout: 3000 })
    .catch(() => {})
  await page.waitForTimeout(50)
  const tx = b.x + (at ? at.x * b.width : b.width / 2)
  const ty = b.y + (at ? at.y * b.height : b.height / 2)
  await page.mouse.move(tx, ty, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.move(tx + 1, ty, { steps: 2 })
  await page.mouse.up()
}

test.beforeAll(async () => {
  if (process.platform !== 'win32') chmodSync(fakeClaude, 0o755)
  tmp = mkdtempSync(path.join(tmpdir(), 'claude-helper-e2e-'))
  project = path.join(tmp, 'my project')
  // A git repository as far as the branch on its tab is concerned.
  mkdirSync(path.join(project, '.git'), { recursive: true })
  writeFileSync(path.join(project, '.git', 'HEAD'), 'ref: refs/heads/e2e-branch\n')
  other = path.join(tmp, 'other project')
  mkdirSync(other)
  const userData = path.join(tmp, 'userData')
  mkdirSync(userData)
  writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ recentFolders: [project, other] })
  )

  // One earlier conversation in the project, as Claude Code would have stored it.
  const claudeConfig = path.join(tmp, 'claude-config')
  const sessions = path.join(claudeConfig, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(sessions, { recursive: true })
  writeFileSync(
    path.join(sessions, `${PAST_SESSION}.jsonl`),
    [
      { type: 'user', cwd: project, message: { role: 'user', content: 'please fix the login' } },
      { type: 'ai-title', aiTitle: 'Fix the login bug' }
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')
  )

  // CLAUDE_HELPER_EXE=<packaged executable> runs the same checks against a packaged build.
  const packaged = process.env.CLAUDE_HELPER_EXE
  app = await electron.launch({
    ...(packaged
      ? { executablePath: packaged, args: [] }
      : { args: [path.join(root, 'out/main/index.js')], cwd: root }),
    env: {
      ...process.env,
      CLAUDE_HELPER_USER_DATA: userData,
      CLAUDE_HELPER_CLAUDE_PATH: fakeClaude,
      CLAUDE_HELPER_E2E: '1',
      CLAUDE_CONFIG_DIR: claudeConfig
    }
  })
  page = await app.firstWindow()
  // Answer "stop running process?" confirmations with OK.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never
    dialog.showMessageBoxSync = () => 0
  })
})

test.afterAll(async () => {
  if (app) {
    await app.close()
    await expect.poll(fakeClaudeProcessCount, { timeout: 15_000 }).toBe(0)
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('opens a recent folder, talks to the process, resizes, and restarts after exit', async () => {
  await expect(page.getByRole('heading', { name: 'Start a Claude session' })).toBeVisible()

  await page.getByText('Continue last').click()
  await page.locator('.recent-open', { hasText: 'my project' }).click()

  await waitForText('READY')
  const text = await terminalText()
  expect(text).toContain('args=[--continue]')
  expect(text).toContain(`CWD=${project}`)
  expect(text).toContain('TERM=xterm-256color COLORTERM=truecolor')
  await expect(page.getByRole('tab', { name: /my project/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /my project/ }).locator('.tab-branch')).toHaveText(
    'e2e-branch'
  )
  await expect(subTabs()).toHaveCount(1)

  await activePane().locator('.xterm').click()
  await page.keyboard.type('hi')
  await waitForText('GOT:H')
  await waitForText('GOT:I')

  // Shift+Enter is sent as Ctrl+J (newline in claude's prompt).
  await page.keyboard.press('Shift+Enter')
  await waitForText('GOT:\\N')

  // Resizing the window resizes the PTY.
  const sizes = async (): Promise<number> =>
    (await terminalText()).match(/SIZE=(\d+)x(\d+)/g)?.length ?? 0
  const before = await sizes()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700))
  await expect.poll(sizes, { timeout: 20_000 }).toBeGreaterThan(before)

  await page.keyboard.type('q')
  await expect(page.getByText('Claude exited with code 3.')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Restart' }).click()
  await waitForText('READY')
  await expect(page.getByText('Claude exited with code 3.')).toBeHidden()
})

test('+ adds another Claude terminal as a sub-tab of the folder', async () => {
  await page.getByRole('button', { name: 'New Claude session' }).click()
  await expect(subTabs()).toHaveCount(2)
  await waitForText('args=[--session-id ') // new conversations get an id up front
  await expect(subTabs().nth(1)).toContainText('Claude 2')
})

test('a Claude tab shows when it works, finishes or asks, and is marked when you were elsewhere', async () => {
  // Sub-tabs: [Claude 1, Claude 2]; Claude 2 is open.
  const busy = subTabs().nth(1)
  const folderTab = page.getByRole('tab', { name: /my project/ })
  await activePane().locator('.xterm').click()
  await page.keyboard.type('W')
  await expect(busy.locator('.status-dot')).toHaveClass(/working/)
  await expect(page.locator('.statusbar')).toContainText('working')

  // It finishes while you look elsewhere: idle (yellow), marked until you look.
  await subTabs().nth(0).click()
  await expect(busy).toHaveClass(/attention-finished/, { timeout: 5000 })
  await expect(busy.locator('.status-dot')).toHaveClass(/idle/)
  await expect(folderTab).toHaveClass(/attention-finished/)
  // A toast says where from; looking at the session takes it away.
  const toast = page.locator('.toast')
  await expect(toast).toContainText('my project › Claude 2')
  await expect(toast).toContainText('Claude finished')
  await busy.click()
  await expect(busy).not.toHaveClass(/attention-/)
  await expect(busy.locator('.status-dot')).toHaveClass(/idle/)
  await expect(toast).toHaveCount(0)

  // It asks while you look elsewhere: red, on the folder tab too, until answered.
  await activePane().locator('.xterm').click()
  await page.keyboard.type('A')
  await subTabs().nth(0).click()
  await expect(busy).toHaveClass(/attention-asking/, { timeout: 5000 })
  await expect(busy.locator('.status-dot')).toHaveClass(/asking/)
  await expect(folderTab.locator('.status-dot')).toHaveClass(/asking/)

  // The bell counts what you haven't seen and lists both; an entry opens its session.
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click()
  const list = page.getByRole('dialog', { name: 'Notifications' })
  await expect(list.locator('.notification')).toHaveCount(2)
  await expect(list.locator('.notification.unread')).toContainText('Claude needs your answer')
  await list.locator('.notification.unread').click()
  await expect(list).toBeHidden()
  await expect(busy).toHaveAttribute('aria-selected', 'true')
  await expect(busy).not.toHaveClass(/attention-/)
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.locator('.statusbar')).toContainText('needs your answer')
  await activePane().locator('.xterm').click()
  await page.keyboard.type('1')
  await waitForText('ANSWERED')
  await expect(busy.locator('.status-dot')).toHaveClass(/idle/)

  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await list.getByRole('button', { name: 'Clear' }).click()
  await expect(list.locator('.notification')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('what waits: taskbar, status bar summary, jump shortcut, preview, mute and Do not disturb', async () => {
  // What main tells the taskbar button (progress bar modes; Windows only).
  await app.evaluate(({ BrowserWindow }) => {
    const modes: string[] = []
    ;(globalThis as { modes?: string[] }).modes = modes
    const win = BrowserWindow.getAllWindows()[0]
    win.setProgressBar = ((_: number, o?: { mode?: string }) => {
      modes.push(o?.mode ?? 'normal')
    }) as typeof win.setProgressBar
  })
  const lastMode = (): Promise<string | undefined> =>
    app.evaluate(() => (globalThis as { modes?: string[] }).modes?.at(-1))
  const onWindows = process.platform === 'win32'

  // Sub-tabs: [Claude 1, Claude 2]. Claude 2 asks while you look at Claude 1.
  const busy = subTabs().nth(1)
  const summary = page.locator('.status-waiting')
  await busy.click()
  await activePane().locator('.xterm').click()
  await page.keyboard.type('A')
  if (onWindows) await expect.poll(lastMode).toBe('indeterminate')
  await subTabs().nth(0).click()
  await expect(summary).toContainText('1 needs your answer', { timeout: 5000 })
  if (onWindows) await expect.poll(lastMode).toBe('error')

  // Hovering its tab shows what it asks.
  await busy.hover()
  await expect(page.locator('.tab-preview')).toContainText('Do you want to proceed?')
  await page.mouse.move(5, 300)
  await expect(page.locator('.tab-preview')).toHaveCount(0)

  // The shortcut goes there; answering clears the summary and the taskbar.
  await activePane().locator('.xterm').click()
  await page.keyboard.press('Control+Shift+J')
  await expect(busy).toHaveAttribute('aria-selected', 'true')
  await activePane().locator('.xterm').click()
  await page.keyboard.type('1')
  await waitForText('ANSWERED')
  await expect(summary).toHaveCount(0)
  if (onWindows) await expect.poll(lastMode).toBe('none')

  // Muted: still marked and listed, but no toast and not counted as waiting.
  const toast = page.locator('.toast')
  const list = page.getByRole('dialog', { name: 'Notifications' })
  const bell = page.getByRole('button', { name: /^Notifications/ })
  await busy.getByRole('button', { name: /^Settings for / }).click()
  await page.getByRole('checkbox', { name: /Mute this session/ }).check()
  await busy.click()
  await expect(busy.locator('.tab-muted')).toBeVisible()
  await activePane().locator('.xterm').click()
  await page.keyboard.type('W')
  await subTabs().nth(0).click()
  await expect(busy).toHaveClass(/attention-finished/, { timeout: 5000 })
  await expect(toast).toHaveCount(0)
  await expect(summary).toHaveCount(0)
  await bell.click()
  await expect(list.locator('.notification').first()).toContainText('(muted)')
  await page.keyboard.press('Escape')
  await busy.click() // ⚙ shows on the open tab
  await busy.getByRole('button', { name: /^Settings for / }).click()
  await page.getByRole('checkbox', { name: /Mute this session/ }).uncheck()
  await busy.click()

  // Do not disturb: no toast either, but the list still fills.
  await bell.click()
  await list.getByRole('checkbox', { name: /Do not disturb/ }).check()
  const listed = await list.locator('.notification').count()
  await page.keyboard.press('Escape')
  await activePane().locator('.xterm').click()
  await page.keyboard.type('W')
  await subTabs().nth(0).click()
  await expect(busy).toHaveClass(/attention-finished/, { timeout: 5000 })
  await expect(toast).toHaveCount(0)
  await bell.click()
  await expect(list.locator('.notification')).toHaveCount(listed + 1)
  await list.getByRole('checkbox', { name: /Do not disturb/ }).uncheck()
  await list.getByRole('button', { name: 'Clear' }).click()
  await page.keyboard.press('Escape')
  await busy.click()
})

test('the ▾ menu opens a shell in the folder', async () => {
  await page.getByRole('button', { name: 'New terminal…' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'New conversation' })).toBeVisible()
  const shell =
    process.platform === 'win32'
      ? menu.getByRole('menuitem', { name: 'Command Prompt' })
      : menu.getByRole('menuitem').last()
  await shell.click()
  await expect(subTabs()).toHaveCount(3)
  await activePane().locator('.xterm').click()
  await page.keyboard.type('echo hello-from-shell')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await terminalText()).split('hello-from-shell').length - 1, {
      timeout: 20_000
    })
    .toBeGreaterThanOrEqual(2) // the typed command and its output
})

test('split right, resize the divider, and close a pane', async () => {
  await subTabs().nth(1).click()
  await page.getByRole('button', { name: 'Split' }).click()
  await page.getByRole('menuitem', { name: /Split right/ }).click()
  const panes = activeSubTab().locator('.pane')
  await expect(panes).toHaveCount(2)
  await expect(subTabs().nth(1).locator('.pane-count')).toHaveText('2')
  await waitForText('READY', panes.nth(1))

  const width = async (): Promise<number> => (await panes.nth(0).boundingBox())!.width
  const before = await width()
  const splitter = activeSubTab().locator('.splitter')
  const box = (await splitter.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  expect(await width()).toBeLessThan(before - 100)

  await panes.nth(1).getByRole('button', { name: /Close/ }).click()
  await expect(panes).toHaveCount(1)
})

test('drag a sub-tab onto a pane edge to split, then drag the pane back out', async () => {
  // Sub-tabs: [Claude 1, Claude 2, Command Prompt/shell]. Dock the shell to the right of Claude 2.
  await subTabs().nth(1).click()
  const target = activeSubTab().locator('.pane').first()
  await drag(subTabs().nth(2), target, { x: 0.92, y: 0.5 })
  await expect(subTabs()).toHaveCount(2)
  const panes = activeSubTab().locator('.pane')
  await expect(panes).toHaveCount(2)
  // The shell keeps running; it moved, it was not restarted.
  await waitForText('hello-from-shell', panes.nth(1))

  // Drag the shell's pane header back onto the sub-tab row → its own sub-tab again.
  await drag(panes.nth(1).locator('.pane-header'), page.locator('.subtabbar .spacer'))
  await expect(subTabs()).toHaveCount(3)
  await expect(activeSubTab().locator('.pane')).toHaveCount(1)
  await waitForText('hello-from-shell')
})

test('recent folders list past sessions, and one click resumes a session', async () => {
  await page.getByRole('button', { name: 'New folder tab' }).click()
  await page.getByRole('button', { name: /Show recent sessions in my project/ }).click()
  const session = page.getByRole('button', { name: /Fix the login bug/ })
  await expect(session).toBeVisible()
  await session.click()

  // The folder is already open: the session joins it as a new sub-tab, no extra folder tab.
  await expect(page.locator('.tabbar .tab')).toHaveCount(1)
  await expect(subTabs()).toHaveCount(4)
  await waitForText(`args=[--resume ${PAST_SESSION}]`)
  await expect(subTabs().nth(3)).toContainText('Fix the login bug')
})

test('drag a folder tab to reorder the folder tabs', async () => {
  await page.getByRole('button', { name: 'New folder tab' }).click()
  await page.locator('.recent-open', { hasText: 'other project' }).click()
  await waitForText('READY')
  const folderTabs = page.locator('.tabbar .tab')
  await expect(folderTabs).toHaveCount(2)
  await expect(folderTabs.nth(1)).toContainText('other project')

  await drag(folderTabs.nth(1), folderTabs.nth(0), { x: 0.2, y: 0.5 })

  await expect(folderTabs.nth(0)).toContainText('other project')
  await expect(folderTabs.nth(1)).toContainText('my project')
})

test('drag a sub-tab to reorder the tabs of a folder', async () => {
  await page.locator('.tabbar .tab', { hasText: 'my project' }).click()
  const names = (): Promise<string[]> => subTabs().locator('.tab-title').allInnerTexts()
  const before = await names()

  await drag(subTabs().nth(0), subTabs().nth(1), { x: 0.9, y: 0.5 })

  await expect.poll(names).toEqual([before[1], before[0], ...before.slice(2)])
})

test('join two folders in folder settings to see them side by side', async () => {
  const folderTabs = page.locator('.tabbar .tab')
  const otherTab = folderTabs.filter({ hasText: 'other project' })
  await otherTab.click()
  await otherTab.getByRole('button', { name: 'Settings for other project' }).click()
  const popover = page.getByRole('dialog', { name: 'Settings for other project' })
  await popover.getByLabel('Join sessions to').selectOption({ label: 'my project' })
  await expect(popover).toBeHidden()

  // my project on the left, other project on the right, and next to each other in the tab row.
  const panels = page.locator('.workspace-panel:not([hidden])')
  await expect(panels).toHaveCount(2)
  await expect(folderTabs.nth(0)).toContainText('my project')
  await expect(folderTabs.nth(1)).toContainText('other project')
  await expect(panels.nth(0).locator('.pair-label')).toHaveText('my project')
  await expect(panels.nth(1).locator('.pair-label')).toHaveText('other project')
  const left = (await panels.nth(0).boundingBox())!
  expect(left.x).toBeLessThan((await panels.nth(1).boundingBox())!.x)

  // The divider between them resizes both.
  const box = (await page.locator('.folder-splitter').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  expect((await panels.nth(0).boundingBox())!.width).toBeLessThan(left.width - 100)

  // Clicking into the left folder makes it the active one.
  await panels.nth(0).locator('.subtab-panel:not([hidden]) .pane').first().click()
  await expect(folderTabs.nth(0)).toHaveAttribute('aria-selected', 'true')

  // None, from either folder's settings, shows them one at a time again.
  await folderTabs.nth(0).getByRole('button', { name: 'Settings for my project' }).click()
  await page.locator('.tab-settings').getByLabel('Join sessions to').selectOption('')
  await expect(panels).toHaveCount(1)
})

test('Ctrl + mouse wheel changes the font size', async () => {
  const api = (): Promise<number> =>
    page.evaluate(async () => {
      const { api } = window as unknown as { api: ClaudeHelperApi }
      return (await api.getSettings()).fontSize
    })
  const before = await api()
  const box = (await activePane().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(api).toBe(before + 1)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 100)
  await page.keyboard.up('Control')
  await expect.poll(api).toBe(before)
})

test('settings dialog saves changes', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Font size').fill('17')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  const settings = await page.evaluate(() =>
    (window as unknown as { api: ClaudeHelperApi }).api.getSettings()
  )
  expect(settings.fontSize).toBe(17)
})

test('⚙ on a folder tab sets its title and color', async () => {
  const saved = (): Promise<{ colors: object; titles: object }> =>
    page.evaluate(async () => {
      const s = await (window as unknown as { api: ClaudeHelperApi }).api.getSettings()
      return { colors: s.folderColors, titles: s.folderTitles }
    })
  const tab = page.locator('.tabbar .tab').first()
  const popover = page.locator('.tab-settings')
  const title = popover.getByLabel('Title')
  await tab.click()

  await tab.getByRole('button', { name: 'Settings for my project' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings for my project' })).toBeVisible()
  await expect(title).toBeFocused()
  await title.fill('Frontend')
  await expect(tab.locator('.tab-title')).toHaveText('Frontend')
  await popover.getByRole('button', { name: 'Blue' }).click()
  await expect(tab).toHaveCSS('background-color', 'rgb(37, 99, 235)')
  await title.press('Enter')
  await expect(popover).toBeHidden()
  await expect
    .poll(saved)
    .toEqual({ colors: { [project]: '#2563eb' }, titles: { [project]: 'Frontend' } })

  // Right-click opens it too. Esc undoes what changed since it opened.
  await tab.click({ button: 'right' })
  await title.fill('Something else')
  await popover.getByLabel('Custom color').fill('#123456')
  await expect(tab).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(tab.locator('.tab-title')).toHaveText('Frontend')
  await expect(tab).toHaveCSS('background-color', 'rgb(37, 99, 235)')

  // Reset goes back to the folder's name, No color drops the color.
  await tab.getByRole('button', { name: 'Settings for Frontend' }).click()
  await popover.getByRole('button', { name: 'Reset' }).click()
  await popover.getByRole('button', { name: 'No color' }).click()
  await tab.click() // a click outside closes it
  await expect(popover).toBeHidden()
  await expect(tab.locator('.tab-title')).toHaveText('my project')
  await expect.poll(saved).toEqual({ colors: {}, titles: {} })
})

test('the folder button on a tab opens the folder in the file manager', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openPath = async (p: string) => {
      opened.push(p)
      return ''
    }
  })
  const tab = page.getByRole('tab', { name: /my project/ })
  await tab.getByRole('button', { name: /^Open my project in / }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual([project])
})

test('⚙ on a terminal tab or a pane title bar sets its title and color', async () => {
  await page.locator('.tabbar .tab').first().click()
  await page.getByRole('button', { name: 'New Claude session' }).click()
  const tab = subTabs().last()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  const popover = page.locator('.tab-settings')
  const title = popover.getByLabel('Title')

  await tab.getByRole('button', { name: /^Settings for Claude/ }).click()
  await title.fill('Backend API')
  await popover.getByRole('button', { name: 'Green' }).click()
  await title.press('Enter')
  await expect(popover).toBeHidden()
  await expect(tab.locator('.tab-title')).toHaveText('Backend API')
  await expect(tab).toHaveCSS('background-color', 'rgb(21, 128, 61)')

  // In a split, each pane's title bar has its own ⚙.
  await page.getByRole('button', { name: 'Split' }).click()
  await page.getByRole('menuitem', { name: /Split right/ }).click()
  const panes = activeSubTab().locator('.pane')
  await expect(panes).toHaveCount(2)
  await panes
    .nth(1)
    .getByRole('button', { name: /^Settings for Claude/ })
    .click()
  await title.fill('Tests')
  await title.press('Enter')
  await expect(panes.nth(1).locator('.pane-title')).toHaveText('Tests')
  await expect(panes.nth(0).locator('.pane-title')).toHaveText('Backend API')
  await expect(panes.nth(0).locator('.pane-header')).toHaveClass(/colored/)
})
