// Builds the Linux installers (AppImage and deb) in a Linux container, so Windows and macOS can
// make them too. node-pty is a native module and has to be compiled on Linux.
import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import path from 'path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'installers')
mkdirSync(out, { recursive: true })

const steps = [
  // Copy the sources only: the host's node_modules and build output hold binaries for the host OS.
  'mkdir /build',
  'tar -C /src --exclude=./.git --exclude=./node_modules --exclude=./out --exclude=./installers -cf - . | tar -C /build -xf -',
  'cd /build',
  'npm ci',
  'npm run build:linux',
  'cp installers/*.AppImage installers/*.deb /out/',
  // On a Linux host the files would otherwise belong to root.
  'chown "$(stat -c %u:%g /out)" /out/*.AppImage /out/*.deb'
]

const { status } = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${root}:/src:ro`,
    '-v',
    `${out}:/out`,
    'node:22-bookworm',
    'bash',
    '-c',
    steps.join(' && ')
  ],
  { stdio: 'inherit' }
)
process.exit(status ?? 1)
