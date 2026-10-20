import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'

// Two layers need a colour mode - the `cds--*` class on <html> (app.scss keys
// its light/dark token bridge off it) and the Ant Design ConfigProvider - so
// this context owns the single source of truth and exposes:
//
//   - `preference`  what the user picked (system | a concrete theme name)
//   - `theme`       the resolved theme name, applied as a `cds--<name>` class
//                   on <html>; the names are the historical Carbon ones and
//                   are kept because stored preferences still use them
//   - `colorScheme` the same decision reduced to light/dark, consumed by the
//                   Ant Design ConfigProvider (see theme/AntdProvider.tsx)
//
// `white`/`g10` are both light and `g90`/`g100` are both dark, so the two
// layers never disagree. The four names stay accepted for stored preferences;
// the picker only offers system/light/dark.
export const THEME_NAMES = ['white', 'g10', 'g90', 'g100'] as const
export type ThemeName = (typeof THEME_NAMES)[number]

export const THEME_PREFERENCES = ['system', ...THEME_NAMES] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

// The palette picker only offers three choices now that the shell is Ant
// Design: follow the OS, or force light/dark. The remaining Carbon names stay
// accepted so preferences stored before the migration keep working; they are
// folded into the equivalent choice on read.
export const THEME_CHOICES = ['system', 'g10', 'g100'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

const LEGACY_CHOICES: Record<string, ThemeChoice> = {
  white: 'g10',
  g90: 'g100',
}

/** Colour mode shared by the `cds--` token bridge and Ant Design. */
export type ColorScheme = 'light' | 'dark'

const DARK_THEMES: ReadonlySet<ThemeName> = new Set<ThemeName>(['g90', 'g100'])

export function resolveColorScheme(theme: ThemeName): ColorScheme {
  return DARK_THEMES.has(theme) ? 'dark' : 'light'
}

const STORAGE_KEY = 'ocm.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ThemeName {
  if (preference !== 'system') return preference
  return systemDark ? 'g100' : 'g10'
}

export interface ThemeContextValue {
  /** The stored preference: "system" or an explicit theme name. */
  preference: ThemePreference
  /** The resolved theme name currently applied to <html> (kept `g10`/`g100` naming). */
  theme: ThemeName
  /** Light/dark projection of `theme`, used by the Ant Design provider. */
  colorScheme: ColorScheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if ((THEME_PREFERENCES as readonly string[]).includes(stored ?? '')) {
      return LEGACY_CHOICES[stored as string] ?? (stored as ThemePreference)
    }
  } catch {
    // localStorage unavailable (private mode etc.) - fall through to default.
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia(DARK_QUERY).matches,
  )

  // Track the OS color scheme so the "system" preference follows it live.
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(preference, systemDark)
  const colorScheme = resolveColorScheme(theme)

  // Apply the resolved theme class to <html> before paint (layout effect, so
  // the header and the content area never show different themes for a frame)
  // and persist the preference. The class is also set by an inline script in
  // index.html so the very first paint already matches; this keeps it in sync
  // afterwards.
  useLayoutEffect(() => {
    const root = document.documentElement
    for (const name of THEME_NAMES) root.classList.remove(`cds--${name}`)
    root.classList.add(`cds--${theme}`)
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Ignore storage failures; the in-memory preference still applies.
    }
  }, [theme, preference])

  const setPreference = useCallback((pref: ThemePreference) => setPreferenceState(pref), [])

  const value = useMemo(
    () => ({ preference, theme, colorScheme, setPreference }),
    [preference, theme, colorScheme, setPreference],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
