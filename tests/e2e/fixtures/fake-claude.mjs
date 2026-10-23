// Stand-in for the claude CLI in e2e tests: reports how it was launched, echoes keystrokes
// (uppercased, so the echo is distinguishable from xterm's own rendering), reports resizes,
// "works" for 1.5 s on "W" (then asks like a permission prompt on "A"), rings the bell on "B",
// and exits with code 3 when "q" is pressed.
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const out = process.stdout
const args = process.argv.slice(2)
/** @param {string} flag @returns {string | undefined} */
function after(flag) {
  return args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined
}

// Which conversation this "claude" has open, like the real one decides it.
const CONTINUED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const session =
  after('--session-id') ??
  after('--resume') ??
  (args.includes('--continue') ? CONTINUED : randomUUID())

// Like Claude Code, register the running process in <config>/sessions/<pid>.json.
if (process.env.CLAUDE_CONFIG_DIR) {
  const dir = join(process.env.CLAUDE_CONFIG_DIR, 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${process.pid}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: session,
      cwd: process.cwd(),
      startedAt: Date.now()
    })
  )
}

out.write(`FAKE-CLAUDE args=[${args.join(' ')}]\r\n`)
out.write(`CWD=${process.cwd()}\r\n`)
out.write(`TERM=${process.env.TERM} COLORTERM=${process.env.COLORTERM}\r\n`)
out.write(`SESSION=${session}\r\n`)
out.write(`SIZE=${out.columns}x${out.rows}\r\n`)
out.write('READY\r\n')

out.on('resize', () => out.write(`SIZE=${out.columns}x${out.rows}\r\n`))

/** A prompt like Claude's permission question is on screen. */
let asking = false

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (data) => {
  if (data === 'q') {
    out.write('BYE\r\n', () => process.exit(3))
    return
  }
  // "W": work for a moment, with the window titles the real claude sets. "A": work, then ask
  // like its permission prompt does; "1" answers. "B": ring the bell.
  if (data === 'W' || data === 'A') {
    out.write('\x1b]0;◐ Fake task\x07')
    setTimeout(() => {
      out.write('\x1b]0;✳ Fake task\x07')
      if (data === 'A') {
        asking = true
        out.write('Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n\r\nEsc to cancel\r\n')
      }
    }, 1500)
  }
  if (data === '1' && asking) {
    asking = false
    out.write('\x1b[2J\x1b[HANSWERED\r\n')
  }
  if (data === 'B') out.write('\x07')
  const shown = JSON.stringify(data).slice(1, -1)
  out.write(`GOT:${shown.toUpperCase()}\r\n`)
})
