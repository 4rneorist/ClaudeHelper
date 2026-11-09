import { load } from 'js-yaml'

/**
 * Skills and agents are Markdown with YAML frontmatter between `---` lines. Fields are read with a
 * YAML parser but written line by line, so whatever else the frontmatter holds (comments, lists,
 * fields this app doesn't know) stays as it was.
 */
export interface Frontmatter {
  /** The YAML between the `---` lines (with its last newline), or null when there is none. */
  yaml: string | null
  body: string
}

export function splitFrontmatter(text: string): Frontmatter {
  const open = /^---[ \t]*\n/.exec(text)
  if (!open) return { yaml: null, body: text }
  const rest = text.slice(open[0].length)
  const close = /^---[ \t]*(?:\n|$)/m.exec(rest)
  if (!close) return { yaml: null, body: text }
  return { yaml: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) }
}

export function joinFrontmatter(yaml: string | null, body: string): string {
  if (yaml === null) return body
  const lines = yaml === '' || yaml.endsWith('\n') ? yaml : yaml + '\n'
  return `---\n${lines}---\n${body}`
}

/** The frontmatter's fields; throws when it isn't valid YAML. */
export function readFields(yaml: string | null): Record<string, unknown> {
  if (yaml === null) return {}
  const value = load(yaml)
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** A field as text: lists joined with commas ("Read, Grep"), nothing as ''. */
export function fieldText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(fieldText).join(', ')
  return ''
}

/** The description to show in a list, or the problem with the file. */
export function describe(
  text: string,
  /** Skills and agents need both; a command or output style does without. */
  required = true
): { description: string; title?: string; problem?: string } {
  const { yaml, body } = splitFrontmatter(text)
  // A command without a description shows its first line.
  const firstLine = (): string =>
    body
      .split('\n')
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find(Boolean) ?? ''
  if (yaml === null) {
    return required
      ? { description: '', problem: 'No frontmatter (the --- block at the top)' }
      : { description: firstLine() }
  }
  try {
    const fields = readFields(yaml)
    const description = fieldText(fields.description).trim()
    const title = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : null
    const named = title ? { title } : {}
    if (description) return { description, ...named }
    return required
      ? { description, ...named, problem: 'No description' }
      : { description: firstLine(), ...named }
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { description: '', problem: `The frontmatter isn't valid YAML: ${message}` }
  }
}

const KEYWORD = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i

/** A string as a YAML value: as it is when that reads back the same, quoted otherwise. */
export function yamlScalar(value: string): string {
  const plain =
    /^[\p{L}\p{N}_/(][^\n]*$/u.test(value) &&
    !/: |\s#|:$|\s$/.test(value) &&
    !KEYWORD.test(value) &&
    Number.isNaN(Number(value)) &&
    !/^\d{4}-\d\d-\d\d/.test(value)
  return plain ? value : JSON.stringify(value)
}

/** The top-level key a line starts, if it starts one. */
function keyOf(line: string): string | null {
  const m = /^([^\s#'"-][^:]*?):(?:[ \t]|$)/.exec(line)
  return m ? m[1] : null
}

/**
 * Sets a top-level field to a string or true/false (replacing its value, even one spread over
 * several lines), or removes it with undefined. A new field goes at the end; `name` goes first.
 */
export function setField(yaml: string, key: string, value: string | boolean | undefined): string {
  const lines = yaml === '' ? [] : yaml.replace(/\n$/, '').split('\n')
  const start = lines.findIndex((line) => keyOf(line) === key)
  const shown = typeof value === 'boolean' ? String(value) : value && yamlScalar(value)
  const line = value === undefined ? [] : [`${key}: ${shown}`]
  if (start === -1) {
    if (key === 'name') lines.unshift(...line)
    else lines.push(...line)
  } else {
    // Its value goes on while lines are indented, blank, or list items.
    let end = start + 1
    while (end < lines.length && /^(?:[ \t]|-(?:[ \t]|$)|[ \t]*$)/.test(lines[end])) end++
    while (end > start + 1 && lines[end - 1].trim() === '') end--
    lines.splice(start, end - start, ...line)
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/** Sets a field in a whole file's text; a file without frontmatter gets one. */
export function setTextField(
  text: string,
  key: string,
  value: string | boolean | undefined
): string {
  const { yaml, body } = splitFrontmatter(text)
  if (yaml === null && value === undefined) return text
  return joinFrontmatter(setField(yaml ?? '', key, value), yaml === null ? '\n' + body : body)
}

/** A new skill; its name is added when it gets one. */
export function newSkillText(): string {
  return [
    '---',
    'description: What this skill does, and when Claude should use it.',
    '---',
    '',
    'Step-by-step instructions for Claude.',
    ''
  ].join('\n')
}

/** A new agent; its name is added when it gets one. */
export function newAgentText(): string {
  return [
    '---',
    'description: When Claude should hand work to this agent.',
    '---',
    '',
    'You are … Describe its role, how it works, and what it reports back.',
    ''
  ].join('\n')
}

/** A new command: what you type after it arrives as $ARGUMENTS. */
export function newCommandText(): string {
  return [
    '---',
    'description: What this command does.',
    'argument-hint: [what to pass]',
    '---',
    '',
    'What Claude should do. $ARGUMENTS is what you type after the command.',
    ''
  ].join('\n')
}

/** A new output style; its name is added when it gets one. */
export function newOutputStyleText(): string {
  return [
    '---',
    'description: How Claude answers in this style.',
    '---',
    '',
    'How Claude should talk and work in this style. This takes the place of its usual',
    'instructions for software work, unless the style keeps them.',
    ''
  ].join('\n')
}
