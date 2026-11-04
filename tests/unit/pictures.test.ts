import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPicture } from '../../src/main/pictures'

describe('readPicture', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-helper-pictures-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("reads a picture's bytes, with its type", async () => {
    const file = path.join(dir, 'sea.PNG')
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const picture = await readPicture(file)
    expect(picture?.type).toBe('image/png')
    expect([...picture!.data]).toEqual([0x89, 0x50, 0x4e, 0x47])
    writeFileSync(path.join(dir, 'b.jpeg'), 'x')
    expect((await readPicture(path.join(dir, 'b.jpeg')))?.type).toBe('image/jpeg')
  })

  it("reads nothing that isn't a picture file", async () => {
    writeFileSync(path.join(dir, 'notes.txt'), 'secret')
    expect(await readPicture(path.join(dir, 'notes.txt'))).toBeNull()
    expect(await readPicture(path.join(dir, 'missing.png'))).toBeNull()
    expect(await readPicture('relative.png')).toBeNull()
    expect(await readPicture(dir + path.sep + 'folder.png' + path.sep)).toBeNull()
  })
})
