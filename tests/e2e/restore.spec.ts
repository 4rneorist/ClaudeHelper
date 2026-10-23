import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { UiState } from '../../src/shared/uiState'
import { fakeClaudeProcessCount } from './helpers'

// Closes the app and starts it again: folders, tabs, splits, sizes, the window and each Claude
// tab's conversation must come back.

test.describe.configure({ mode: 'serial' })

const root = path.resolve(__dirname, '../..')
const fakeClaude = path.join(
  __dirname,
  'fixtures',
  process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude'
)
const CONTINUED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

let tmp: string
let project: string
let userData: string
let claudeConfig: string

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const packaged = process.env.CLAUDE_HELPER_EXE
  const app = await electron.launch({
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
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0 // "Quit and stop running sessions?" → Quit
  })
  return { app, page }
}

/** Closes the window like the user would (X button) and waits for the app to exit. */
async function closeApp(app: ElectronApplication): Promise<void> {
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await exited
}

const text = async (pane: Locator): Promise<string> =>
  (await pane.locator('.xterm-rows').innerText()).replace(/\n/g, '')
const waitFor = (pane: Locator, s: string | RegExp): Promise<void> =>
  expect.poll(() => text(pane), { timeout: 20_000 }).toMatch(s)

test.beforeAll(() => {
  if (process.platform !== 'win32') chmodSync(fakeClaude, 0o755)
  tmp = mkdtempSync(path.join(tmpdir(), 'claude-helper-restore-'))
  project = path.join(tmp, 'my project')
  mkdirSync(project)
  userData = path.join(tmp, 'userData')
  mkdirSync(userData)
  claudeConfig = path.join(tmp, 'claude-config')
  writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recentFolders: [project] }))
})

test.afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

test('reopens folders, tabs, splits, sizes and conversations after a restart', async () => {
  // ---- first run: build a layout -------------------------------------------------------------
  let { app, page } = await launch()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760))

  await page.locator('.recent-open', { hasText: 'my project' }).click()
  const panel = (): Locator =>
    page.locator('.workspace-panel:not([hidden]) .subtab-panel:not([hidden])')
  const first = panel().locator('.pane').first()
  await waitFor(first, 'READY')
  const newId = (await text(first)).match(new RegExp(`--session-id (${UUID.source})`))![1]

  // Split it with another new conversation and make the left pane narrow.
  await page.getByRole('button', { name: 'Split' }).click()
  await page.getByRole('menuitem', { name: /Split right/ }).click()
  await expect(panel().locator('.pane')).toHaveCount(2)
  const box = (await panel().locator('.splitter').boundingBox())!
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 250, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const splitId = (await text(panel().locator('.pane').nth(1))).match(
    new RegExp(`--session-id (${UUID.source})`)
  )![1]

  // A second tab that continues the last conversation: its id is only known from the registry.
  await page.getByRole('button', { name: 'New terminal…' }).click()
  await page.getByRole('menuitem', { name: 'Continue last' }).click()
  await waitFor(panel().locator('.pane').first(), `SESSION=${CONTINUED}`)

  await closeApp(app) // saves the UI state while the processes can still be asked
  const saved = JSON.parse(readFileSync(path.join(userData, 'ui-state.json'), 'utf8')) as UiState
  expect(saved.workspaces).toHaveLength(1)
  expect(saved.terminals.map((t) => t.claudeSessionId).sort()).toEqual(
    [newId, splitId, CONTINUED].sort()
  )

  // Claude Code has a transcript for the first conversation (the user chatted in it).
  const transcripts = path.join(claudeConfig, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(transcripts, { recursive: true })
  writeFileSync(path.join(transcripts, `${newId}.jsonl`), '{}\n')
  writeFileSync(path.join(transcripts, `${CONTINUED}.jsonl`), '{}\n')

  // ---- second run: everything comes back ------------------------------------------------------
  ;({ app, page } = await launch())
  await expect(page.locator('.tabbar .tab')).toHaveCount(1)
  await expect(page.locator('.tabbar .tab')).toContainText('my project')
  const subTabs = page.locator('.workspace-panel:not([hidden]) .subtab')
  await expect(subTabs).toHaveCount(2)
  // The tab that was active (the continued conversation) is active again, and resumed.
  await expect(subTabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await waitFor(panel().locator('.pane').first(), `args=[--resume ${CONTINUED}]`)

  // The split came back with its proportions; the chatted-in conversation resumes, the empty
  // one starts again under the same id.
  await subTabs.nth(0).click()
  const panes = panel().locator('.pane')
  await expect(panes).toHaveCount(2)
  await waitFor(panes.nth(0), `args=[--resume ${newId}]`)
  await waitFor(panes.nth(1), `args=[--session-id ${splitId}]`)
  const left = (await panes.nth(0).boundingBox())!.width
  const right = (await panes.nth(1).boundingBox())!.width
  expect(left).toBeLessThan(right * 0.6)

  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  expect(size).toEqual([1100, 760])
  await closeApp(app)
})

test('restoring can be switched off in settings', async () => {
  const settingsFile = path.join(userData, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'))
  writeFileSync(settingsFile, JSON.stringify({ ...settings, restoreSession: false }))
  const { app, page } = await launch()
  await expect(page.getByRole('heading', { name: 'Start a Claude session' })).toBeVisible()
  await closeApp(app)
})

test('saves as you go: a crash still restores tabs, conversations and the window', async () => {
  // Fresh profile; nothing gets closed cleanly in this test.
  userData = path.join(tmp, 'userData-crash')
  mkdirSync(userData)
  writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recentFolders: [project] }))
  const stateFile = path.join(userData, 'ui-state.json')
  const readState = (): UiState | null => {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8')) as UiState
    } catch {
      return null
    }
  }

  let { app, page } = await launch()
  const panel = (): Locator =>
    page.locator('.workspace-panel:not([hidden]) .subtab-panel:not([hidden])')

  // Opening a folder is saved right away.
  await page.locator('.recent-open', { hasText: 'my project' }).click()
  await waitFor(panel().locator('.pane').first(), 'READY')
  await expect.poll(() => readState()?.workspaces.length ?? 0, { timeout: 5000 }).toBe(1)

  // A "Continue last" tab: its conversation id appears in Claude Code's registry, not in our
  // launch args, and is saved as soon as claude registers it.
  await page.getByRole('button', { name: 'New terminal…' }).click()
  await page.getByRole('menuitem', { name: 'Continue last' }).click()
  await expect
    .poll(() => readState()?.terminals.map((t) => t.claudeSessionId) ?? [], { timeout: 5000 })
    .toContain(CONTINUED)

  // Window size is saved while the app runs.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650))
  const windowFile = path.join(userData, 'window.json')
  await expect
    .poll(
      () => {
        try {
          return JSON.parse(readFileSync(windowFile, 'utf8')).bounds.width
        } catch {
          return 0
        }
      },
      { timeout: 5000 }
    )
    .toBe(900)

  // Crash: kill the real main process (Playwright's app.process() is only a launcher), so no
  // close handler and no final save run.
  const mainPid = await app.evaluate(() => process.pid)
  process.kill(mainPid)
  // ConPTY / the pty takes the sessions down with the app; nothing may be left running.
  await expect.poll(fakeClaudeProcessCount, { timeout: 10_000 }).toBe(0)

  ;({ app, page } = await launch())
  const subTabs = page.locator('.workspace-panel:not([hidden]) .subtab')
  await expect(subTabs).toHaveCount(2)
  await waitFor(panel().locator('.pane').first(), `args=[--resume ${CONTINUED}]`)
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  expect(size).toEqual([900, 650])
  await closeApp(app)
})
