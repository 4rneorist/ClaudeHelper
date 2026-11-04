import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SOUND_NAMES,
  TELEGRAM_ALWAYS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_PRIVATE_CHAT,
  type Settings,
  type SoundName,
  type TelegramResult,
  type PictureFit,
  type ThemeSetting
} from '../../../shared/ipc'
import { playSound, SOUND_LABELS } from '../sounds'
import { useStore } from '../store'

/** Choices for the reminder while a session keeps asking, in minutes; 0 = never. */
const REMINDER_CHOICES = [0, 2, 5, 10, 15, 30]

/** When Telegram messages go out: every time, whenever in the background, or after minutes away. */
const AWAY_CHOICES = [TELEGRAM_ALWAYS, 0, 2, 5, 10, 15, 30]

function awayLabel(minutes: number): string {
  if (minutes === TELEGRAM_ALWAYS) return 'Every time, even with the app in front of me'
  if (minutes === 0) return 'Whenever the app is in the background'
  return `When I've been away ${minutes} minutes`
}

/** The Telegram settings typed in are usable (or left empty). */
function telegramProblems(draft: Settings): { token: boolean; chat: boolean } {
  const token = draft.telegramBotToken.trim()
  const chat = draft.telegramChatId.trim()
  return {
    token: token !== '' && !TELEGRAM_BOT_TOKEN.test(token),
    chat: chat !== '' && !TELEGRAM_CHAT_ID.test(chat)
  }
}

export function SettingsDialog(): React.JSX.Element {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const close = (): void => setSettingsOpen(false)

  return (
    <dialog ref={dialogRef} className="settings" onClose={close} aria-labelledby="settings-title">
      {/* Mounted per opening, so the draft always starts from the current settings. */}
      {open && settings && <SettingsForm initial={settings} onDone={close} />}
    </dialog>
  )
}

function SettingsForm({
  initial,
  onDone
}: {
  initial: Settings
  onDone(): void
}): React.JSX.Element {
  const claude = useStore((s) => s.claude)
  const appInfo = useStore((s) => s.appInfo)
  const updateSettings = useStore((s) => s.updateSettings)
  const [draft, setDraft] = useState(initial)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const {
      claudePath,
      fontSize,
      theme,
      terminalPicture,
      terminalPictureStrength,
      terminalPictureFit,
      experimentalConptyDll,
      restoreSession,
      lazyRestore,
      notifyWhenWaiting,
      soundOnAttention,
      finishedSound,
      askingSound,
      soundVolume,
      reminderMinutes,
      jiraEnabled,
      jiraUrl,
      telegramEnabled,
      telegramBotToken,
      telegramChatId,
      telegramAwayMinutes,
      telegramRemote
    } = draft
    await updateSettings({
      claudePath,
      fontSize,
      theme,
      terminalPicture,
      terminalPictureStrength,
      terminalPictureFit,
      experimentalConptyDll,
      restoreSession,
      lazyRestore,
      notifyWhenWaiting,
      soundOnAttention,
      finishedSound,
      askingSound,
      soundVolume,
      reminderMinutes,
      jiraEnabled,
      jiraUrl,
      telegramEnabled,
      telegramBotToken,
      telegramChatId,
      telegramAwayMinutes,
      telegramRemote
    })
    onDone()
  }

  // Saving would quietly drop a token or chat ID that can't work.
  const telegram = telegramProblems(draft)
  const telegramInvalid = draft.telegramEnabled && (telegram.token || telegram.chat)

  const browse = async (): Promise<void> => {
    const path = await window.api.pickExecutable()
    if (path) setDraft({ ...draft, claudePath: path })
  }

  const choosePicture = async (): Promise<void> => {
    const path = await window.api.pickPicture()
    if (path) setDraft((d) => ({ ...d, terminalPicture: path }))
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <h2 id="settings-title">Settings</h2>

      <label className="field">
        <span>Claude executable</span>
        <div className="row">
          <input
            type="text"
            value={draft.claudePath}
            placeholder={
              claude?.found && !claude.explicit ? `Auto-detected: ${claude.path}` : 'Auto-detect'
            }
            onChange={(e) => setDraft({ ...draft, claudePath: e.target.value })}
            spellCheck={false}
          />
          <button type="button" className="secondary" onClick={() => void browse()}>
            Browse…
          </button>
        </div>
        <small className="muted">Leave empty to find claude on PATH automatically.</small>
      </label>

      <label className="field">
        <span>Font size</span>
        <input
          type="number"
          min={8}
          max={32}
          value={draft.fontSize}
          onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
        />
        <small className="muted">Ctrl/Cmd + and − also change it, Ctrl/Cmd 0 resets.</small>
      </label>

      <label className="field">
        <span>Theme</span>
        <select
          value={draft.theme}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value as ThemeSetting })}
        >
          <option value="system">Follow system</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>

      <label className="field">
        <span>Background picture</span>
        <div className="row">
          <input
            type="text"
            value={draft.terminalPicture}
            placeholder="None"
            readOnly
            spellCheck={false}
          />
          <button type="button" className="secondary" onClick={() => void choosePicture()}>
            Choose…
          </button>
          {draft.terminalPicture && (
            <button
              type="button"
              className="secondary"
              onClick={() => setDraft({ ...draft, terminalPicture: '' })}
            >
              Remove
            </button>
          )}
        </div>
        <small className="muted">
          Behind the text of every terminal tab, Claude and shells alike (PNG, JPEG, GIF, WebP or
          BMP, up to 20 MB).
        </small>
      </label>

      <fieldset className="nested" disabled={!draft.terminalPicture}>
        <label className="sound-row">
          <span>How much it shows</span>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={draft.terminalPictureStrength}
            onChange={(e) =>
              setDraft({ ...draft, terminalPictureStrength: Number(e.target.value) })
            }
          />
          <span className="muted">{draft.terminalPictureStrength}%</span>
        </label>
        <label className="field">
          <span>Fit</span>
          <select
            value={draft.terminalPictureFit}
            onChange={(e) =>
              setDraft({ ...draft, terminalPictureFit: e.target.value as PictureFit })
            }
          >
            <option value="fill">Fill the tab (may crop it)</option>
            <option value="fit">Fit the whole picture</option>
            <option value="stretch">Stretch to the tab</option>
            <option value="tile">Tile</option>
          </select>
        </label>
        <small className="muted">
          Faint is easiest to read on: text that would get lost on it is darkened or lightened.
        </small>
      </fieldset>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.restoreSession}
          onChange={(e) => setDraft({ ...draft, restoreSession: e.target.checked })}
        />
        <span>
          Reopen folders, tabs and splits from last time
          <small className="muted"> — Claude tabs resume their conversations</small>
        </span>
      </label>

      <fieldset className="nested" disabled={!draft.restoreSession}>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={draft.lazyRestore}
            onChange={(e) => setDraft({ ...draft, lazyRestore: e.target.checked })}
          />
          <span>
            Resume each tab only when you first open it
            <small className="muted">
              {' '}
              — a quicker start, and no memory spent on tabs you never open
            </small>
          </span>
        </label>
      </fieldset>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.notifyWhenWaiting}
          onChange={(e) => setDraft({ ...draft, notifyWhenWaiting: e.target.checked })}
        />
        <span>
          Notify me when a session needs me
          <small className="muted">
            {' '}
            — Claude finished or waits for an answer while the app is in the background
          </small>
        </span>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.soundOnAttention}
          onChange={(e) => setDraft({ ...draft, soundOnAttention: e.target.checked })}
        />
        <span>
          Play a sound when a session finishes or needs me
          <small className="muted">
            {' '}
            — a different one for each, also for the session you are looking at
          </small>
        </span>
      </label>

      <fieldset className="field sounds" disabled={!draft.soundOnAttention}>
        <SoundPicker
          label="When a session finishes"
          value={draft.finishedSound}
          volume={draft.soundVolume}
          onChange={(finishedSound) => setDraft({ ...draft, finishedSound })}
        />
        <SoundPicker
          label="When a session needs your answer"
          value={draft.askingSound}
          volume={draft.soundVolume}
          onChange={(askingSound) => setDraft({ ...draft, askingSound })}
        />
        <label className="sound-row">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.soundVolume}
            onChange={(e) => setDraft({ ...draft, soundVolume: Number(e.target.value) })}
          />
          <span className="muted">{draft.soundVolume}%</span>
        </label>
      </fieldset>

      <label className="field">
        <span>Remind me while a session keeps asking for my answer</span>
        <select
          value={draft.reminderMinutes}
          onChange={(e) => setDraft({ ...draft, reminderMinutes: Number(e.target.value) })}
        >
          {REMINDER_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'Never' : `Every ${m} minutes`}
            </option>
          ))}
        </select>
        <small className="muted">
          At most 3 times, until you look at it. Muted sessions and Do not disturb are skipped.
        </small>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.telegramEnabled}
          onChange={(e) => setDraft({ ...draft, telegramEnabled: e.target.checked })}
        />
        <span>
          Send me a Telegram message when a session needs me
          <small className="muted"> — from your own bot, for when you are away</small>
        </span>
      </label>

      <fieldset className="nested telegram" disabled={!draft.telegramEnabled}>
        <TelegramSettings draft={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
      </fieldset>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.jiraEnabled}
          onChange={(e) => setDraft({ ...draft, jiraEnabled: e.target.checked })}
        />
        <span>
          Show the Jira ticket from the git branch on folder tabs
          <small className="muted"> — bugfix/MT-123_login shows MT-123; a click opens it</small>
        </span>
      </label>

      <fieldset className="nested" disabled={!draft.jiraEnabled}>
        <label className="field">
          <span>Ticket URL</span>
          <input
            type="text"
            inputMode="url"
            value={draft.jiraUrl}
            placeholder="https://your-company.atlassian.net/browse/{key}"
            onChange={(e) => setDraft({ ...draft, jiraUrl: e.target.value })}
            spellCheck={false}
          />
          <small className="muted">
            {'{key}'} is replaced by the ticket key; without it, the key goes at the end.
          </small>
        </label>
      </fieldset>

      {appInfo?.platform === 'win32' && (
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={draft.experimentalConptyDll}
            onChange={(e) => setDraft({ ...draft, experimentalConptyDll: e.target.checked })}
          />
          <span>
            Experimental: use the newer console engine bundled from Windows Terminal (OpenConsole)
            instead of the one built into Windows
            <small className="muted">
              {' '}
              — applies to new sessions; known to occasionally crash the app on exit
            </small>
          </span>
        </label>
      )}

      <div className="row end">
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary"
          disabled={telegramInvalid}
          title={telegramInvalid ? 'Fix the Telegram bot token or chat ID first' : undefined}
        >
          Save
        </button>
      </div>
    </form>
  )
}

const openLink = (url: string) => (e: React.MouseEvent) => {
  e.preventDefault()
  window.api.openExternal(url)
}

/**
 * The bot token and chat ID, with the steps to get them, a button that finds the chat, and a
 * test message. Find and the test use what is typed in, before it is saved.
 */
function TelegramSettings({
  draft,
  onChange
}: {
  draft: Settings
  onChange(patch: Partial<Settings>): void
}): React.JSX.Element {
  const token = draft.telegramBotToken.trim()
  const chatId = draft.telegramChatId.trim()
  const problems = telegramProblems(draft)
  const tokenOk = TELEGRAM_BOT_TOKEN.test(token)
  const chatOk = TELEGRAM_CHAT_ID.test(chatId)
  // The steps start open until it is set up; after that they stay out of the way.
  const [helpOpen] = useState(!tokenOk || !chatOk)
  const [status, setStatus] = useState<{ busy?: boolean; ok?: boolean; text: string } | null>(null)

  const run = async (busyText: string, request: () => Promise<TelegramResult>): Promise<void> => {
    setStatus({ busy: true, text: busyText })
    const res = await request()
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
    } else if (res.chatId) {
      onChange({ telegramChatId: res.chatId })
      setStatus({ ok: true, text: `Found ${res.chatName || 'the chat'}: send a test message` })
    } else if (res.topics !== undefined) {
      const topics = res.topics
        ? 'each session gets its own topic (Threaded Mode is on)'
        : 'no topics per session: Threaded Mode is off for this bot'
      setStatus({ ok: true, text: `Sent: check Telegram. ${topics}` })
    } else {
      setStatus({ ok: true, text: 'Sent: check Telegram' })
    }
  }
  const find = (): Promise<void> =>
    run('Looking for the chat…', () => window.api.findTelegramChat(token))
  const test = (): Promise<void> => run('Sending…', () => window.api.testTelegram(token, chatId))

  return (
    <>
      <details className="telegram-help" open={helpOpen}>
        <summary>How to set up the bot</summary>
        <ol>
          <li>
            In Telegram, open{' '}
            <a href="https://t.me/BotFather" onClick={openLink('https://t.me/BotFather')}>
              @BotFather
            </a>
            , send <code>/newbot</code>, then pick a name and a username that ends in{' '}
            <code>bot</code>. It replies with the bot token: paste it below.
          </li>
          <li>
            Open your new bot from BotFather&apos;s reply (<code>t.me/your_bot</code>) and press{' '}
            <b>Start</b>. A bot can&apos;t write to you before that.
          </li>
          <li>
            Press <b>Find</b> next to Chat ID. By hand instead: open{' '}
            {tokenOk ? (
              <a href="#" onClick={openLink(`https://api.telegram.org/bot${token}/getUpdates`)}>
                the bot&apos;s updates
              </a>
            ) : (
              <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code>
            )}{' '}
            in a browser and copy the number after{' '}
            <code>&quot;chat&quot;:{'{'}&quot;id&quot;:</code>. For a group, add the bot to it and
            send <code>/start@your_bot</code> there; a group&apos;s ID starts with <code>-</code>.
          </li>
          <li>
            Press <b>Send test message</b>, then Save.
          </li>
          <li>
            Optional: tick <b>Let me answer and send prompts from Telegram</b> below. Then reply to
            a message about a chat to send it a prompt, tap a question&apos;s buttons to answer it,
            or use the bot&apos;s commands: <code>/chats</code>, <code>/newchat [name]</code>,{' '}
            <code>/prompt &lt;chat&gt; &lt;text&gt;</code>,{' '}
            <code>/getchat &lt;chat&gt; [rows]</code> and <code>/help</code>.
          </li>
          <li>
            Optional: a topic per session, with <b>Threaded Mode</b> on for your bot in @BotFather.
            See <b>Topics per session</b> below.
          </li>
        </ol>
        <small className="muted">
          Messages say which folder and tab need you and the conversation&apos;s name. Only with
          remote control on do they also show Claude&apos;s questions, and the screen when you ask
          for it. They go from this app straight to Telegram.
        </small>
      </details>

      <label className="field">
        <span>Bot token</span>
        <input
          type="password"
          value={draft.telegramBotToken}
          placeholder="123456789:AAE…"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange({ telegramBotToken: e.target.value })}
        />
        {problems.token && (
          <small className="field-error">
            Not a bot token: it looks like 123456789:AAE… (copy it again from @BotFather)
          </small>
        )}
      </label>

      <label className="field">
        <span>Chat ID</span>
        <div className="row">
          <input
            type="text"
            value={draft.telegramChatId}
            placeholder="Press Find, or e.g. 123456789"
            spellCheck={false}
            onChange={(e) => onChange({ telegramChatId: e.target.value })}
          />
          <button
            type="button"
            className="secondary"
            disabled={!tokenOk || status?.busy}
            title={tokenOk ? 'The chat that last wrote to the bot' : 'Paste the bot token first'}
            onClick={() => void find()}
          >
            Find
          </button>
        </div>
        {problems.chat && (
          <small className="field-error">
            Not a chat ID: a number (a group&apos;s starts with -), or @channel
          </small>
        )}
      </label>

      <label className="field">
        <span>When</span>
        <select
          value={draft.telegramAwayMinutes}
          onChange={(e) => onChange({ telegramAwayMinutes: Number(e.target.value) })}
        >
          {AWAY_CHOICES.map((m) => (
            <option key={m} value={m}>
              {awayLabel(m)}
            </option>
          ))}
        </select>
        <small className="muted">
          Away: no mouse or keyboard for that long, or the screen is locked. Muted sessions and Do
          not disturb are skipped.
        </small>
      </label>

      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={!tokenOk || !chatOk || status?.busy}
          onClick={() => void test()}
        >
          Send test message
        </button>
        {status && (
          <small
            className={status.busy ? 'muted' : status.ok ? 'telegram-ok' : 'field-error'}
            role="status"
          >
            {status.text}
          </small>
        )}
      </div>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.telegramRemote}
          onChange={(e) => onChange({ telegramRemote: e.target.checked })}
        />
        <span>
          Let me answer and send prompts from Telegram
          <small className="muted">
            {' '}
            — whoever has your Telegram account can then make Claude work on this computer
          </small>
        </span>
      </label>
      {draft.telegramRemote && chatOk && !TELEGRAM_PRIVATE_CHAT.test(chatId) && (
        <small className="field-error">
          Only your own chat with the bot can control the app: use its ID (a number without -)
        </small>
      )}

      <TopicsInfo token={tokenOk ? token : ''} chatId={chatId} />
    </>
  )
}

/**
 * Topics per session: whether the bot has Threaded Mode on (asked of Telegram when Settings opens,
 * and again on request), and how to switch it on in @BotFather.
 */
function TopicsInfo({ token, chatId }: { token: string; chatId: string }): React.JSX.Element {
  type Answer = { token: string; on?: boolean; error?: string }
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [asking, setAsking] = useState(false)
  const ask = useCallback(async (): Promise<Answer> => {
    const res = await window.api.checkTelegramTopics(token)
    return res.ok ? { token, on: res.topics === true } : { token, error: res.error }
  }, [token])
  // Asked when Settings opens, and when the token changes.
  useEffect(() => {
    if (!token) return
    let live = true
    void ask().then((a) => {
      if (live) setAnswer(a)
    })
    return () => {
      live = false
    }
  }, [token, ask])
  const check = async (): Promise<void> => {
    setAsking(true)
    setAnswer(await ask())
    setAsking(false)
  }
  const state: { busy?: boolean; on?: boolean; error?: string } | null =
    asking || answer?.token !== token ? { busy: true } : answer

  const groupChat = TELEGRAM_CHAT_ID.test(chatId) && !TELEGRAM_PRIVATE_CHAT.test(chatId)
  let status: { text: string; className: string }
  if (!token)
    status = { text: 'Paste the bot token to see whether it has topics', className: 'muted' }
  else if (!state || state.busy) status = { text: 'Asking Telegram…', className: 'muted' }
  else if (state.error) status = { text: state.error, className: 'field-error' }
  else if (!state.on) {
    status = { text: 'Off: Threaded Mode is off for this bot', className: 'muted' }
  } else if (groupChat) {
    status = {
      text: 'Threaded Mode is on, but topics need your own chat with the bot, not a group',
      className: 'field-error'
    }
  } else {
    status = {
      text: '✓ On: each session gets its own topic (Threaded Mode is on)',
      className: 'telegram-ok'
    }
  }

  return (
    <div className="field">
      <span>Topics per session</span>
      <div className="row">
        <small className={status.className} role="status">
          {status.text}
        </small>
        <button
          type="button"
          className="secondary"
          disabled={!token || state?.busy}
          onClick={() => void check()}
        >
          Check again
        </button>
      </div>
      <small className="muted">
        With <b>Threaded Mode</b> on for your bot, your chat with it gets a topic per Claude
        session, like a group&apos;s topics, the first time that session has something for you. Its
        notifications, questions and Claude&apos;s replies go there, and what you write in a topic
        goes to that session. Without it, everything stays in the one chat.
      </small>
      <div className="telegram-help muted">
        To switch it on:
        <ol>
          <li>Update Telegram: topics in chats with bots are new.</li>
          <li>
            In{' '}
            <a href="https://t.me/BotFather" onClick={openLink('https://t.me/BotFather')}>
              @BotFather
            </a>{' '}
            tap <b>Open</b>. It is BotFather&apos;s app: its typed commands don&apos;t have this
            setting.
          </li>
          <li>
            Pick your bot, then <b>Bot Settings</b> → turn on <b>Threaded Mode</b>.
          </li>
          <li>
            Optional: turn off <b>Disallow users to create new threads</b>, so you can delete old
            topics yourself.
          </li>
          <li>
            Press <b>Check again</b> here. The chat ID has to be your own chat with the bot, not a
            group.
          </li>
        </ol>
      </div>
    </div>
  )
}

/** A sound for one kind of call, with a button to hear it at the chosen volume. */
function SoundPicker({
  label,
  value,
  volume,
  onChange
}: {
  label: string
  value: SoundName
  volume: number
  onChange(name: SoundName): void
}): React.JSX.Element {
  return (
    <div className="sound-row">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as SoundName)}
      >
        {SOUND_NAMES.map((name) => (
          <option key={name} value={name}>
            {SOUND_LABELS[name]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="secondary play"
        aria-label={`Play ${SOUND_LABELS[value]}`}
        title="Play"
        onClick={() => playSound(value, volume)}
      >
        ▶
      </button>
    </div>
  )
}
