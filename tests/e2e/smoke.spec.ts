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
  mkdirSync(project)
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

test('drag a folder tab onto a pane of another folder to split them', async () => {
  await page.getByRole('button', { name: 'New folder tab' }).click()
  await page.locator('.recent-open', { hasText: 'other project' }).click()
  await waitForText('READY')
  const folderTabs = page.locator('.tabbar .tab')
  await expect(folderTabs).toHaveCount(2)

  await folderTabs.first().click()
  const count = await subTabs().count()
  await drag(folderTabs.nth(1), activePane(), { x: 0.92, y: 0.5 })

  await expect(folderTabs).toHaveCount(1) // the emptied folder tab closes
  await expect(subTabs()).toHaveCount(count)
  const panes = activeSubTab().locator('.pane')
  await expect(panes).toHaveCount(2)
  await expect(panes.nth(1).locator('.pane-folder')).toHaveText('other project')
  // Still the same running session, still in its own folder.
  await expect // the narrower pane wraps the long path, so ignore line breaks
    .poll(async () => (await terminalText(panes.nth(1))).replace(/\n/g, ''), { timeout: 20_000 })
    .toContain(`CWD=${other}`)
})

test('drop a sub-tab on another folder tab to move it there', async () => {
  await page.getByRole('button', { name: 'New folder tab' }).click()
  await page.locator('.recent-open', { hasText: 'other project' }).click()
  await waitForText('READY')
  const folderTabs = page.locator('.tabbar .tab')
  await folderTabs.first().click()
  const count = await subTabs().count()

  await drag(subTabs().last(), folderTabs.nth(1))

  // Now showing the other folder, which gained the moved tab (labelled with its own folder).
  await expect(folderTabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(subTabs()).toHaveCount(2)
  await expect(subTabs().nth(1)).toContainText('· my project')
  await folderTabs.first().click()
  await expect(subTabs()).toHaveCount(count - 1)
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
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Font size').fill('17')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  const settings = await page.evaluate(() =>
    (window as unknown as { api: ClaudeHelperApi }).api.getSettings()
  )
  expect(settings.fontSize).toBe(17)
})

test('right-click a folder tab to give the folder its own color', async () => {
  const colors = (): Promise<Record<string, string>> =>
    page.evaluate(
      async () =>
        (await (window as unknown as { api: ClaudeHelperApi }).api.getSettings()).folderColors
    )
  const tab = page.getByRole('tab', { name: /my project/ })
  await tab.click()
  const picker = page.getByRole('dialog', { name: 'Tab color for my project' })

  await tab.click({ button: 'right' })
  await picker.getByRole('button', { name: 'Blue' }).click()
  await expect(picker).toBeHidden()
  await expect(tab).toHaveCSS('background-color', 'rgb(37, 99, 235)')
  expect(await colors()).toEqual({ [project]: '#2563eb' })

  await tab.click({ button: 'right' })
  await picker.getByLabel('Custom color').fill('#123456')
  await expect(tab).toHaveCSS('background-color', 'rgb(18, 52, 86)')

  await tab.click({ button: 'right' })
  await picker.getByRole('button', { name: 'No color' }).click()
  await expect.poll(colors).toEqual({})
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
