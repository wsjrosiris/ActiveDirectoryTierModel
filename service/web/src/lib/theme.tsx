import * as React from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'tm-theme'

interface ThemeCtx {
  theme: ThemePref
  resolved: 'light' | 'dark'
  setTheme: (t: ThemePref) => void
  toggle: () => void
}

const Ctx = React.createContext<ThemeCtx | null>(null)

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

const mql = () => window.matchMedia('(prefers-color-scheme: dark)')

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePref>(readPref)
  const [systemDark, setSystemDark] = React.useState(() => mql().matches)

  React.useEffect(() => {
    const m = mql()
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  React.useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }, [resolved])

  const setTheme = React.useCallback((t: ThemePref) => {
    setThemeState(t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* ignore */
    }
  }, [])

  const value = React.useMemo<ThemeCtx>(
    () => ({ theme, resolved, setTheme, toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark') }),
    [theme, resolved, setTheme],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const c = React.useContext(Ctx)
  if (!c) throw new Error('useTheme outside ThemeProvider')
  return c
}
