/** Path comparison as the OS's default filesystem sees it (Windows/macOS are case-insensitive). */
export function samePath(a: string, b: string, platform: string): boolean {
  const norm = (p: string): string =>
    (platform === 'win32' ? p.replace(/\//g, '\\') : p).replace(/[\\/]+$/, '')
  return platform === 'linux'
    ? norm(a) === norm(b)
    : norm(a).toLowerCase() === norm(b).toLowerCase()
}

/** The value a map holds for path `p`, with keys compared as paths. */
export function findByPath<T>(
  map: Record<string, T> | undefined,
  p: string,
  platform: string
): T | null {
  if (!map) return null
  const hit = Object.keys(map).find((key) => samePath(key, p, platform))
  return hit === undefined ? null : map[hit]
}

export function folderName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || p
}
