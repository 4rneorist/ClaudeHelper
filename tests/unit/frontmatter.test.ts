import { describe, expect, it } from 'vitest'
import {
  describe as describeItem,
  joinFrontmatter,
  newSkillText,
  readFields,
  setField,
  setTextField,
  splitFrontmatter,
  yamlScalar
} from '../../src/shared/frontmatter'

const SKILL = `---
name: review
description: >-
  Reviews a change
  for bugs.
allowed-tools:
  - Read
  - Grep
# keep this comment
model: sonnet
---

# Review

Steps.
`

describe('splitFrontmatter / joinFrontmatter', () => {
  it('splits the YAML from the body and puts them back the same', () => {
    const { yaml, body } = splitFrontmatter(SKILL)
    expect(yaml).toMatch(/^name: review\n[\s\S]*model: sonnet\n$/)
    expect(body).toBe('\n# Review\n\nSteps.\n')
    expect(joinFrontmatter(yaml, body)).toBe(SKILL)
  })

  it('has no frontmatter without the opening and closing lines', () => {
    expect(splitFrontmatter('# Just text\n')).toEqual({ yaml: null, body: '# Just text\n' })
    expect(splitFrontmatter('---\nname: x\n')).toEqual({ yaml: null, body: '---\nname: x\n' })
    expect(splitFrontmatter('---\n---\nbody')).toEqual({ yaml: '', body: 'body' })
  })
})

describe('setField', () => {
  const { yaml } = splitFrontmatter(SKILL)

  it('replaces a value that spans lines, leaving the rest as it was', () => {
    const next = setField(yaml!, 'description', 'Finds bugs: before merging')
    expect(next).toContain('description: "Finds bugs: before merging"\nallowed-tools:\n  - Read')
    expect(next).toContain('# keep this comment\nmodel: sonnet')
    expect(readFields(next)).toMatchObject({
      name: 'review',
      description: 'Finds bugs: before merging',
      'allowed-tools': ['Read', 'Grep']
    })
  })

  it('replaces a list, adds new fields at the end and the name first, removes with undefined', () => {
    let next = setField(yaml!, 'allowed-tools', 'Read, Grep, Glob')
    expect(next).toContain('allowed-tools: Read, Grep, Glob\n# keep this comment')
    next = setField(next, 'color', 'blue')
    expect(next.endsWith('model: sonnet\ncolor: blue\n')).toBe(true)
    next = setField(setField(next, 'name', undefined), 'name', 'checker')
    expect(next.startsWith('name: checker\ndescription:')).toBe(true)
    next = setField(next, 'model', undefined)
    expect(next).not.toContain('model')
  })

  it('writes true and false as YAML booleans', () => {
    const next = setField('', 'disable-model-invocation', true)
    expect(readFields(next)['disable-model-invocation']).toBe(true)
  })
})

describe('yamlScalar', () => {
  it('reads back exactly what was typed', () => {
    const values = [
      'plain words',
      'Use when: the user asks',
      'ends with a colon:',
      'has # a hash',
      '#starts with hash',
      '- a dash',
      'yes',
      'NO',
      '123',
      '1e5',
      '2026-01-01',
      'trailing space ',
      'two\nlines',
      '"quoted"',
      "it's fine",
      '[not a list]',
      '{not: a map}',
      '*star',
      '@at',
      'Привіт, світ'
    ]
    for (const v of values) {
      expect(readFields(`key: ${yamlScalar(v)}\n`).key).toBe(v)
    }
    expect(yamlScalar('plain words')).toBe('plain words')
  })
})

describe('setTextField and describe', () => {
  it('gives a file without frontmatter one', () => {
    const text = setTextField('# Notes\n', 'description', 'Takes notes')
    expect(text).toBe('---\ndescription: Takes notes\n---\n\n# Notes\n')
    expect(describeItem(text)).toEqual({ description: 'Takes notes' })
  })

  it('says what is wrong with a file', () => {
    expect(describeItem('# Notes').problem).toMatch(/No frontmatter/)
    expect(describeItem('---\nname: x\n---\n').problem).toBe('No description')
    expect(describeItem('---\ndescription: [oops\n---\n').problem).toMatch(/isn't valid YAML/)
    expect(describeItem(newSkillText()).description).toMatch(/What this skill does/)
  })
})
