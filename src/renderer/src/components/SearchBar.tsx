import { useEffect, useRef, useState } from 'react'
import { getTerminal, SEARCH_HIGHLIGHT_LIMIT } from '../terminal/TerminalSession'

/**
 * Find in a terminal's scrollback: matches are highlighted as you type, Enter and Shift+Enter go
 * to the next and previous one, Esc closes. `request` changes when Ctrl+F is pressed again.
 */
export function SearchBar({
  terminal: key,
  request
}: {
  terminal: string
  request: number
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [request])

  useEffect(
    () =>
      getTerminal(key)?.onSearchResults(({ resultIndex, resultCount }) =>
        setResults({ index: resultIndex, count: resultCount })
      ),
    [key]
  )

  const find = (text: string, direction: 'next' | 'previous', incremental = false): void => {
    const found = getTerminal(key)?.find(text, direction, incremental) ?? false
    if (!found) setResults(text ? { index: -1, count: 0 } : null)
  }
  const close = (): void => getTerminal(key)?.closeSearch()

  let count = ''
  if (results && query) {
    const total = results.count >= SEARCH_HIGHLIGHT_LIMIT ? `${results.count}+` : results.count
    count =
      results.count === 0
        ? 'No results'
        : results.index >= 0
          ? `${results.index + 1} of ${total}`
          : `${total} found`
  }

  return (
    <div className="search-bar" role="search" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find"
        aria-label="Find in terminal"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          find(e.target.value, 'next', true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(query, e.shiftKey ? 'previous' : 'next')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <span className="search-count" aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        onClick={() => find(query, 'previous')}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Next match"
        title="Next match (Enter)"
        onClick={() => find(query, 'next')}
      >
        ↓
      </button>
      <button type="button" aria-label="Close search" title="Close (Esc)" onClick={close}>
        ×
      </button>
    </div>
  )
}
