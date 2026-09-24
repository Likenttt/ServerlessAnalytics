import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

function read(): ThemePreference {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(read)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    try {
      if (theme === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', theme)
    } catch {}
  }, [theme])
  return [theme, setTheme] as const
}
