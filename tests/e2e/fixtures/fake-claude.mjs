// Stand-in for the claude CLI in e2e tests: reports how it was launched, echoes keystrokes
// (uppercased, so the echo is distinguishable from xterm's own rendering), reports resizes,
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

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (data) => {
  if (data === 'q') {
    out.write('BYE\r\n', () => process.exit(3))
    return
  }
  const shown = JSON.stringify(data).slice(1, -1)
  out.write(`GOT:${shown.toUpperCase()}\r\n`)
})
