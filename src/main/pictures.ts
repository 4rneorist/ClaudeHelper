import { readFile, stat } from 'fs/promises'
import path from 'path'
import { isPicturePath } from './settingsStore'

// The picture behind the terminals: read here and handed to the renderer as bytes, which shows it
// from a blob: URL (the renderer can't read files itself).

/** Bigger files aren't read: a background doesn't need one, and every byte crosses IPC. */
export const MAX_PICTURE_BYTES = 20 * 1024 * 1024

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

/** A picture file's type and bytes; null when it isn't one, is missing or is too big. */
export async function readPicture(
  file: string
): Promise<{ type: string; data: Uint8Array } | null> {
  const type = TYPES[path.extname(file).slice(1).toLowerCase()]
  if (!type || !isPicturePath(file)) return null
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_PICTURE_BYTES) return null
    return { type, data: new Uint8Array(await readFile(file)) }
  } catch {
    return null
  }
}
