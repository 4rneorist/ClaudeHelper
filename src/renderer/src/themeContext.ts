import { createContext } from 'react'

/** The resolved (never "system") theme, provided by App. */
export const ThemeContext = createContext<'dark' | 'light'>('dark')
