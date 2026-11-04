import { stat } from 'fs/promises'
import path from 'path'
import type { FileLink } from '../shared/ipc'

/** Opening these runs them (or what they point to) instead of showing them. */
const PROGRAMS: Record<string, string[]> = {
  win32: (
    '.exe .com .bat .cmd .ps1 .psm1 .vbs .vbe .js .jse .wsf .wsh .ws .wsc .msc .msi .msp .scr ' +
    '.pif .cpl .hta .lnk .url .reg .jar .py .pyw .pyz .sh .inf .scf .chm .application ' +
    '.appref-ms .appx .appxbundle .msix .msixbundle .settingcontent-ms .library-ms .search-ms ' +
    '.diagcab .gadget .xbap .xll'
  ).split(' '),
  // Bundles such as .app are folders that open as programs.
  darwin: (
    '.app .command .tool .terminal .workflow .action .pkg .mpkg .sh .scpt .applescript .jar ' +
    '.webloc .inetloc .fileloc .prefpane'
  ).split(' '),
  linux: '.desktop .sh .run .appimage .bin .jar'.split(' ')
}

/**
 * Whether opening this file with its default program would run it. On Windows that goes by
 * its extension (PATHEXT included); elsewhere, also any file marked executable.
 */
export function isProgram(
  file: string,
  info: { dir: boolean; mode: number },
  platform: string,
  pathext = ''
): boolean {
  const ext = path.extname(file).toLowerCase()
  const programs = PROGRAMS[platform] ?? PROGRAMS.linux
  if (info.dir) return platform === 'darwin' && programs.includes(ext)
  if (programs.includes(ext)) return true
  if (platform === 'win32') return ext !== '' && pathext.toLowerCase().split(';').includes(ext)
  return (info.mode & 0o111) !== 0
}

export interface FileLinkDeps {
  platform: string
  homedir: string
  /** Windows' PATHEXT: more extensions of programs. */
  pathext: string
}

/** The file or folder at this absolute path, or null when there is none. */
export async function fileLinkAt(full: string, deps: FileLinkDeps): Promise<FileLink | null> {
  try {
    const s = await stat(full)
    const info = { dir: s.isDirectory(), mode: s.mode }
    const program = isProgram(full, info, deps.platform, deps.pathext)
    return { path: full, kind: program ? 'program' : info.dir ? 'folder' : 'file' }
  } catch {
    return null
  }
}

/** A path from a terminal's output, relative to its folder, absolute or under ~. */
export function resolveFileLink(
  cwd: string,
  p: string,
  deps: FileLinkDeps
): Promise<FileLink | null> {
  const expanded = /^~(?=$|[\\/])/.test(p) ? deps.homedir + p.slice(1) : p
  return fileLinkAt(path.resolve(cwd, expanded), deps)
}
